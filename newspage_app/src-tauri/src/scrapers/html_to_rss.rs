use chrono::{DateTime, Utc};
use reqwest::Client;
use scraper::{ElementRef, Html, Selector};
use std::collections::HashSet;

use async_trait::async_trait;

use crate::article::Article;
use crate::db::HtmlToRssRule;
use crate::id_generator::generate_article_id;

use super::{ScrapeContext, ScraperStage};

pub struct HtmlToRssConfig {
    pub url: String,
    pub display_name: String,
    pub container_selector: String,
    pub title_selector: String,
    pub link_selector: String,
    pub date_selector: String,
    pub thumbnail_selector: String,
    pub snippet_selector: String,
    pub author_selector: String,
}

fn normalize_text(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn text_from_selector(root: &ElementRef<'_>, selector_str: &str) -> String {
    if selector_str.is_empty() {
        return String::new();
    }
    let Ok(selector) = Selector::parse(selector_str) else {
        return String::new();
    };
    root.select(&selector)
        .next()
        .map(|el| normalize_text(&el.text().collect::<String>()))
        .unwrap_or_default()
}

fn attr_from_selector(root: &ElementRef<'_>, selector_str: &str, attr: &str) -> String {
    if selector_str.is_empty() {
        return String::new();
    }
    let Ok(selector) = Selector::parse(selector_str) else {
        return String::new();
    };
    root.select(&selector)
        .next()
        .and_then(|el| el.value().attr(attr))
        .map(|v| v.trim().to_string())
        .unwrap_or_default()
}

fn resolve_url(base: &str, relative: &str) -> String {
    if relative.starts_with("http://") || relative.starts_with("https://") {
        return relative.to_string();
    }
    if relative.starts_with("//") {
        if let Ok(parsed) = reqwest::Url::parse(base) {
            return format!("{}:{}", parsed.scheme(), relative);
        }
    }
    if let Ok(base_url) = reqwest::Url::parse(base) {
        if let Ok(joined) = base_url.join(relative) {
            return joined.to_string();
        }
    }
    relative.to_string()
}

fn parse_date_fuzzy(date_str: &str) -> String {
    let trimmed = date_str.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    if let Ok(dt) = DateTime::parse_from_rfc3339(trimmed) {
        return dt.to_rfc3339();
    }
    if let Ok(dt) = DateTime::parse_from_rfc2822(trimmed) {
        return dt.to_rfc3339();
    }

    let common_formats = [
        "%Y/%m/%d %H:%M",
        "%Y/%m/%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d",
        "%Y/%m/%d",
        "%d %b %Y",
        "%d %B %Y",
        "%b %d, %Y",
        "%B %d, %Y",
    ];

    for fmt in &common_formats {
        if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(trimmed, fmt) {
            return dt.and_utc().to_rfc3339();
        }
        if let Ok(d) = chrono::NaiveDate::parse_from_str(trimmed, fmt) {
            return d
                .and_hms_opt(0, 0, 0)
                .unwrap()
                .and_utc()
                .to_rfc3339();
        }
    }

    date_str.to_string()
}

const BROWSER_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
     (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

pub async fn scrape_html_to_rss(config: &HtmlToRssConfig) -> Result<Vec<Article>, String> {
    let client = Client::builder()
        .user_agent(BROWSER_USER_AGENT)
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;
    let response = client
        .get(&config.url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch URL: {}", e))?;
    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    let document = Html::parse_document(&body);

    let container_sel = Selector::parse(&config.container_selector)
        .map_err(|e| format!("Invalid container selector: {}", e))?;

    let containers: Vec<ElementRef<'_>> = document.select(&container_sel).collect();
    if containers.is_empty() {
        return Err("Container selector matched no elements on the page".to_string());
    }

    let now = Utc::now().to_rfc3339();
    let mut articles: Vec<Article> = Vec::new();
    let mut seen_ids: HashSet<String> = HashSet::new();

    for container in &containers {
        let title = text_from_selector(container, &config.title_selector);
        if title.is_empty() {
            continue;
        }

        let link_raw = attr_from_selector(container, &config.link_selector, "href");
        let link = if link_raw.is_empty() {
            String::new()
        } else {
            resolve_url(&config.url, &link_raw)
        };

        let date_raw = text_from_selector(container, &config.date_selector);
        let date = parse_date_fuzzy(&date_raw);

        let thumb_raw = attr_from_selector(container, &config.thumbnail_selector, "src");
        let thumbnail = if thumb_raw.is_empty() {
            String::new()
        } else {
            resolve_url(&config.url, &thumb_raw)
        };

        let snippet = text_from_selector(container, &config.snippet_selector);
        let author_text = text_from_selector(container, &config.author_selector);
        let authors: Vec<String> = if author_text.is_empty() {
            vec![]
        } else {
            vec![author_text]
        };

        let id = generate_article_id(&link, &title);
        if !seen_ids.insert(id.clone()) {
            continue;
        }

        articles.push(Article {
            id,
            title,
            url: link,
            date: if date.is_empty() { now.clone() } else { date },
            source_name: config.display_name.clone(),
            source_icon: String::new(),
            authors,
            language: String::new(),
            thumbnail,
            category: config.display_name.to_lowercase(),
            article_type: "rss".to_string(),
            status: "pending".to_string(),
            ai_summary: String::new(),
            og_content: String::new(),
            snippet,
        });
    }

    if articles.is_empty() {
        return Err("No articles could be extracted. Check your selectors.".to_string());
    }

    Ok(articles)
}

pub struct HtmlToRssScraperStage;

#[async_trait]
impl ScraperStage for HtmlToRssScraperStage {
    fn name(&self) -> &'static str {
        "HTML_TO_RSS"
    }

    fn should_run(&self, ctx: &ScrapeContext) -> bool {
        !ctx.html_to_rss_rules.is_empty()
            && ctx.rss_sources.iter().any(|s| {
                s.source_type == "html_to_rss"
                    && ctx
                        .subscribed_rss_names
                        .contains(&s.display_name.to_ascii_lowercase())
            })
    }

    async fn run(&self, ctx: &ScrapeContext) -> Result<Vec<Article>, String> {
        let active_urls: HashSet<&str> = ctx
            .rss_sources
            .iter()
            .filter(|s| {
                s.source_type == "html_to_rss"
                    && ctx
                        .subscribed_rss_names
                        .contains(&s.display_name.to_ascii_lowercase())
            })
            .map(|s| s.source_ref.as_str())
            .collect();

        let applicable_rules: Vec<&HtmlToRssRule> = ctx
            .html_to_rss_rules
            .iter()
            .filter(|r| active_urls.contains(r.url.as_str()))
            .collect();

        let mut out: Vec<Article> = Vec::new();
        let mut seen_ids: HashSet<String> = HashSet::new();

        for rule in &applicable_rules {
            let config = HtmlToRssConfig {
                url: rule.url.clone(),
                display_name: rule.display_name.clone(),
                container_selector: rule.container_selector.clone(),
                title_selector: rule.title_selector.clone(),
                link_selector: rule.link_selector.clone(),
                date_selector: rule.date_selector.clone(),
                thumbnail_selector: rule.thumbnail_selector.clone(),
                snippet_selector: rule.snippet_selector.clone(),
                author_selector: rule.author_selector.clone(),
            };

            match scrape_html_to_rss(&config).await {
                Ok(articles) => {
                    for article in articles {
                        if seen_ids.insert(article.id.clone()) {
                            out.push(article);
                        }
                    }
                }
                Err(e) => {
                    crate::logging::warn(
                        "Scrape",
                        format!("HTML_TO_RSS failed for {}: {}", rule.url, e),
                        None,
                    );
                }
            }
        }

        Ok(out)
    }
}
