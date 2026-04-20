use async_trait::async_trait;
use chrono::Utc;
use reqwest::Client;
use scraper::{Html, Selector};
use std::collections::HashSet;

use crate::id_generator::generate_article_id;
use crate::article::Article;
use crate::logging;

use super::{ScrapeContext, ScraperStage};

const BAIDU_NEWS_BASE: &str = "https://news.baidu.com";
const SOURCE_NAME: &str = "百度新闻";
const SOURCE_ICON: &str = "src/assets/favicon.ico";

struct BaiduCategoryDef {
    widget_id: &'static str,
    category: &'static str,
}

const BAIDU_CATEGORIES: &[BaiduCategoryDef] = &[
    BaiduCategoryDef { widget_id: "civilnews", category: "Nation" },
    BaiduCategoryDef { widget_id: "InternationalNews", category: "World" },
    BaiduCategoryDef { widget_id: "SportNews", category: "Sports" },
    BaiduCategoryDef { widget_id: "FinanceNews", category: "Business" },
    BaiduCategoryDef { widget_id: "TechNews", category: "Technology" },
    BaiduCategoryDef { widget_id: "InternetNews", category: "Technology" },
    BaiduCategoryDef { widget_id: "HealthNews", category: "Health" },
];

fn build_client() -> Result<Client, String> {
    Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
        .gzip(true)
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))
}

async fn fetch_widget(client: &Client, widget_id: &str) -> Result<String, String> {
    let url = format!("{}/widget?id={}", BAIDU_NEWS_BASE, widget_id);
    logging::info("BaiduNews", format!("Fetching {}", url), None);
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed for {}: {}", widget_id, e))?;
    resp.text()
        .await
        .map_err(|e| format!("Failed to read response for {}: {}", widget_id, e))
}

struct RawArticle {
    title: String,
    url: String,
    thumbnail: String,
}

fn extract_anchor_links(root: &Html, list_sel: &Selector) -> Vec<RawArticle> {
    let a_sel = Selector::parse("a").unwrap();
    let mut results = Vec::new();

    for list in root.select(list_sel) {
        for a in list.select(&a_sel) {
            let href = a.value().attr("href").unwrap_or("").trim();
            if href.is_empty() || href.starts_with("javascript:") {
                continue;
            }
            let title = a.text().collect::<Vec<_>>().join("").trim().to_string();
            if title.is_empty() {
                continue;
            }
            results.push(RawArticle {
                title,
                url: href.to_string(),
                thumbnail: String::new(),
            });
        }
    }

    results
}

fn extract_image_articles(root: &Html) -> Vec<RawArticle> {
    let item_sel = Selector::parse("div.image-mask-item, div.image-list-item").unwrap();
    let a_sel = Selector::parse("a").unwrap();
    let img_sel = Selector::parse("img").unwrap();
    let mut results = Vec::new();

    for item in root.select(&item_sel) {
        let mut title = String::new();
        let mut url = String::new();
        let mut thumbnail = String::new();

        for a in item.select(&a_sel) {
            let href = a.value().attr("href").unwrap_or("").trim();
            if href.is_empty() || href.starts_with("javascript:") {
                continue;
            }
            if url.is_empty() {
                url = href.to_string();
            }
            let text = a.text().collect::<Vec<_>>().join("").trim().to_string();
            if !text.is_empty() && title.is_empty() {
                title = text;
            }
            if let Some(img) = a.select(&img_sel).next() {
                let src = img.value().attr("src").unwrap_or("").trim();
                if !src.is_empty() && thumbnail.is_empty() {
                    thumbnail = src.to_string();
                }
            }
        }

        if !title.is_empty() && !url.is_empty() {
            results.push(RawArticle { title, url, thumbnail });
        }
    }

    results
}

fn extract_topic_articles(root: &Html) -> Vec<RawArticle> {
    let topic_sel = Selector::parse("div.topic").unwrap();
    let a_sel = Selector::parse("a").unwrap();
    let img_sel = Selector::parse("img").unwrap();
    let mut results = Vec::new();

    for topic in root.select(&topic_sel) {
        let mut title = String::new();
        let mut url = String::new();
        let mut thumbnail = String::new();

        for a in topic.select(&a_sel) {
            let href = a.value().attr("href").unwrap_or("").trim();
            if href.is_empty() || href.starts_with("javascript:") {
                continue;
            }
            let text = a.text().collect::<Vec<_>>().join("").trim().to_string();
            if !text.is_empty() && text != "[详细]" && url.is_empty() {
                url = href.to_string();
                title = text;
            }
            if let Some(img) = a.select(&img_sel).next() {
                let src = img.value().attr("src").unwrap_or("").trim();
                if !src.is_empty() && thumbnail.is_empty() {
                    thumbnail = src.to_string();
                }
            }
        }

        if !title.is_empty() && !url.is_empty() {
            results.push(RawArticle { title, url, thumbnail });
        }
    }

    results
}

fn parse_widget(html: &str, category: &str) -> Vec<Article> {
    let document = Html::parse_document(html);
    let now = Utc::now().to_rfc3339();

    let ulist_sel = Selector::parse("ul.ulist.focuslistnews").unwrap();
    let olist_sel = Selector::parse("ol.olist").unwrap();

    let mut seen_urls: HashSet<String> = HashSet::new();
    let mut articles = Vec::new();

    let raw_articles: Vec<RawArticle> = extract_anchor_links(&document, &ulist_sel)
        .into_iter()
        .chain(extract_anchor_links(&document, &olist_sel))
        .chain(extract_image_articles(&document))
        .chain(extract_topic_articles(&document))
        .collect();

    for item in raw_articles {
        if !seen_urls.insert(item.url.clone()) {
            continue;
        }

        let id = generate_article_id(&item.url, &item.title);
        articles.push(Article {
            id,
            title: item.title,
            url: item.url,
            date: now.clone(),
            source_name: SOURCE_NAME.to_string(),
            source_icon: SOURCE_ICON.to_string(),
            authors: Vec::new(),
            language: "zh-CN".to_string(),
            thumbnail: item.thumbnail,
            category: category.to_string(),
            article_type: "html".to_string(),
            ai_summary: String::new(),
            og_content: String::new(),
            snippet: String::new(),
            status: "pending".to_string(),
        });
    }

    articles
}

async fn scrape_baidu_news(
    subscribed_categories: &HashSet<String>,
) -> Result<Vec<Article>, String> {
    let client = build_client()?;

    let active: Vec<&BaiduCategoryDef> = BAIDU_CATEGORIES
        .iter()
        .filter(|c| subscribed_categories.contains(&c.category.to_lowercase()))
        .collect();

    if active.is_empty() {
        return Ok(Vec::new());
    }

    let mut all_articles: Vec<Article> = Vec::new();
    let mut seen_ids: HashSet<String> = HashSet::new();

    for cat_def in active {
        match fetch_widget(&client, cat_def.widget_id).await {
            Ok(html) => {
                let articles = parse_widget(&html, cat_def.category);
                logging::info(
                    "BaiduNews",
                    format!("Widget {} ({}): {} articles", cat_def.widget_id, cat_def.category, articles.len()),
                    None,
                );
                for article in articles {
                    if seen_ids.insert(article.id.clone()) {
                        all_articles.push(article);
                    }
                }
            }
            Err(e) => {
                logging::warn(
                    "BaiduNews",
                    format!("Failed to fetch widget {}: {}", cat_def.widget_id, e),
                    None,
                );
            }
        }
    }

    Ok(all_articles)
}

pub struct BaiduNewsScraperStage;

#[async_trait]
impl ScraperStage for BaiduNewsScraperStage {
    fn name(&self) -> &'static str {
        "BaiduNews"
    }

    fn should_run(&self, ctx: &ScrapeContext) -> bool {
        ctx.enabled_news_sources.iter().any(|s| s == "baidu_news")
            && !ctx.subscribed_news_categories.is_empty()
    }

    async fn run(&self, ctx: &ScrapeContext) -> Result<Vec<Article>, String> {
        scrape_baidu_news(&ctx.subscribed_news_categories).await
    }
}
