use chrono::{DateTime, NaiveDate};
use scraper::{ElementRef, Html, Selector};
use reqwest::Client;
use crate::id_generator::generate_article_id;
use crate::news_item::NewsItem;

const ANN_URL: &str = "https://www.animenewsnetwork.com/";
const ANN_NEWS_URL: &str = "https://www.animenewsnetwork.com/news/?topic=anime";
const DEFAULT_ANN_ITEM_LIMIT: usize = 100;

pub type AnnNewsItem = NewsItem;

pub async fn get_news_html() -> Result<String, String> {
    let client = Client::new();
    
    match client.get(ANN_NEWS_URL).send().await {
        Ok(response) => {
            match response.text().await {
                Ok(html) => Ok(html),
                Err(e) => Err(format!("Failed to read response body: {}", e)),
            }
        }
        Err(e) => Err(format!("Failed to fetch URL: {}", e)),
    }
}

pub async fn get_news_items() -> Result<Vec<String>, String> {
    let html_content = get_news_html().await?;
    let document = Html::parse_document(&html_content);
    
    let selector = Selector::parse("div.herald.box.news.t-news").map_err(|e| format!("Selector parse error: {}", e))?;
    
    let news_items: Vec<String> = document
        .select(&selector)
        .map(|element| element.html())
        .collect();
    
    Ok(news_items)
}

fn build_absolute_url(url: &str) -> String {
    if url.starts_with("http://") || url.starts_with("https://") {
        return url.to_string();
    }

    if let Some(path) = url.strip_prefix('/') {
        return format!("{}{}", ANN_URL, path);
    }

    url.to_string()
}

fn normalize_text(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn first_text_from_selectors(root: &ElementRef<'_>, selectors: &[&str]) -> String {
    for selector_str in selectors {
        if let Ok(selector) = Selector::parse(selector_str) {
            if let Some(node) = root.select(&selector).next() {
                let text = normalize_text(&node.text().collect::<String>());
                if !text.is_empty() {
                    return text;
                }
            }
        }
    }
    String::new()
}

fn first_attr_from_selectors(root: &ElementRef<'_>, selectors: &[&str], attr: &str) -> String {
    for selector_str in selectors {
        if let Ok(selector) = Selector::parse(selector_str) {
            if let Some(node) = root.select(&selector).next() {
                if let Some(value) = node.value().attr(attr) {
                    let value = value.trim();
                    if !value.is_empty() {
                        return value.to_string();
                    }
                }
            }
        }
    }
    String::new()
}

fn article_date_from_url(url: &str) -> Option<NaiveDate> {
    let (_, path_after_news) = url.split_once("/news/")?;
    let date_segment = path_after_news.get(..10)?;
    NaiveDate::parse_from_str(date_segment, "%Y-%m-%d").ok()
}

fn ann_sort_key(item: &AnnNewsItem) -> (Option<i64>, String) {
    let timestamp = DateTime::parse_from_rfc3339(&item.date)
        .ok()
        .map(|datetime| datetime.timestamp())
        .or_else(|| {
            article_date_from_url(&item.url)
                .and_then(|date| date.and_hms_opt(0, 0, 0))
                .map(|datetime| datetime.and_utc().timestamp())
        });

    (timestamp, item.date.clone())
}

fn sort_ann_news_items_by_date_desc(items: &mut [AnnNewsItem]) {
    items.sort_by(|left, right| ann_sort_key(right).cmp(&ann_sort_key(left)));
}

fn truncate_ann_news_items(items: &mut Vec<AnnNewsItem>, limit: Option<usize>) {
    let limit = limit.unwrap_or(DEFAULT_ANN_ITEM_LIMIT);
    items.truncate(limit);
}

pub fn extract_news_item_fields(item_html: &str) -> Option<AnnNewsItem> {
    let fragment = Html::parse_fragment(item_html);

    let root_selector = Selector::parse("div.herald.box.news.t-news, div.wrap, div.thumbnail").ok()?;
    let root = fragment
        .select(&root_selector)
        .next()
        .or_else(|| Selector::parse("div").ok().and_then(|s| fragment.select(&s).next()))?;

    let title = first_text_from_selectors(&root, &["h3 a", "h3"]);
    if title.is_empty() {
        return None;
    }

    let date = first_attr_from_selectors(&root, &[".byline time", "time"], "datetime");
    let date = if date.is_empty() {
        first_text_from_selectors(&root, &[".byline time", "time"])
    } else {
        date
    };

    let raw_thumbnail = first_attr_from_selectors(&root, &[".thumbnail", "div.thumbnail"], "data-src");
    let thumbnail = if raw_thumbnail.is_empty() {
        first_attr_from_selectors(&root, &[".thumbnail", "div.thumbnail"], "style")
            .replace("background-image:", "")
            .replace("url(\"", "")
            .replace("url('", "")
            .replace("url(", "")
            .replace("\")", "")
            .replace("')", "")
            .replace(")", "")
            .replace(';', "")
            .trim()
            .to_string()
    } else {
        build_absolute_url(&raw_thumbnail)
    };

    let raw_article_link = first_attr_from_selectors(&root, &["h3 a", "div.thumbnail a", "a"], "href");
    let url = if raw_article_link.is_empty() {
        String::new()
    } else {
        build_absolute_url(&raw_article_link)
    };
    let id = generate_article_id(&url, &title);

    Some(AnnNewsItem {
        id,
        title,
        url,
        date,
        source_name: String::new(),
        source_icon: String::new(),
        authors: Vec::new(),
        thumbnail,
        tags: Vec::new(),
        category: "anime".to_string(),
        ai_summary: String::new(),
        og_content: String::new(),
        snippet: String::new(),
        is_enriched: false,
    })
}

pub async fn scrape_ann(limit: Option<usize>) -> Result<Vec<AnnNewsItem>, String> {
    let news_items_html = get_news_items().await?;
    let mut items: Vec<_> = news_items_html
        .iter()
        .filter_map(|item_html| extract_news_item_fields(item_html))
        .collect();

    sort_ann_news_items_by_date_desc(&mut items);
    truncate_ann_news_items(&mut items, limit);

    Ok(items)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_item(title: &str, date: &str, url: &str) -> AnnNewsItem {
        AnnNewsItem {
            id: title.to_string(),
            title: title.to_string(),
            url: url.to_string(),
            date: date.to_string(),
            source_name: String::new(),
            source_icon: String::new(),
            authors: Vec::new(),
            thumbnail: String::new(),
            tags: Vec::new(),
            category: "anime".to_string(),
            ai_summary: String::new(),
            og_content: String::new(),
            snippet: String::new(),
            is_enriched: false,
        }
    }

    #[tokio::test]
    async fn live_diagnose_ann_html() {
        let html = get_news_html().await.expect("Failed to fetch ANN HTML");
        println!("\n--- ANN HTML length: {} bytes ---", html.len());

        // Test several candidate selectors and report how many matches each finds
        let candidates = [
            "div.herald.box.news.t-news",
            "div.herald",
            "div.t-news",
            "div.news",
            "article",
            "div.item",
        ];
        let document = scraper::Html::parse_document(&html);
        for sel_str in &candidates {
            let count = scraper::Selector::parse(sel_str)
                .ok()
                .map(|s| document.select(&s).count())
                .unwrap_or(0);
            println!("Selector {:45} → {} matches", sel_str, count);
        }

        // Print inner_html and outer html of first matched item
        if let Ok(sel) = scraper::Selector::parse("div.herald.box.news.t-news") {
            if let Some(first) = document.select(&sel).next() {
                println!("\n--- First item outer html (first 1500 chars) ---\n{}\n---",
                    &first.html()[..first.html().len().min(1500)]);
            }
        }
    }

    #[tokio::test]
    async fn live_scrape_ann_real() {
        let items = scrape_ann(None).await.expect("scrape_ann failed");
        println!("\n=== ANN returned {} items ===", items.len());
        for (i, item) in items.iter().take(5).enumerate() {
            println!(
                "[{}] {}\n    Date: {}\n    URL : {}\n    Thumb: {}\n    Snip: {}\n",
                i + 1, item.title, item.date, item.url, item.thumbnail, item.snippet
            );
        }
        assert!(!items.is_empty(), "Expected at least one ANN item");
    }

    #[test]
    fn extracts_ann_news_item_fields() {
        let html = r#"
        <div class="herald box news t-news" data-topics="article235700 news anime">
            <div class="category-line news t-news"></div>
            <div class="thumbnail" data-src="/thumbnails/crop348x200gGH/cms/news.8/229798/kv6.png.jpg" style="background-image: url(&quot;https://cdn.animenewsnetwork.com/thumbnails/crop348x200gGH/cms/news.8/229798/kv6.png.jpg&quot;);">
              <div class="overlay"></div>
              <a href="/news/2026-03-24/2nd-gundam-hathaway-film-screens-in-u.s-theaters-on-may-15/.235700"></a>
            </div>
            <div class="wrap">
              <div>
                <h3>
                  <a href="/news/2026-03-24/2nd-gundam-hathaway-film-screens-in-u.s-theaters-on-may-15/.235700">2nd <cite>Gundam Hathaway</cite> Film Screens in U.S. Theaters on May 15</a>
                </h3>
                <div class="byline">
                  <time datetime="2026-03-24T16:10:21-04:00">Mar 24, 16:10</time>
                </div>
                <div class="snippet">
                  <span class="hook">Film opened in Japan on January 30</span>
                  <span class="full">Full snippet text...</span>
                </div>
              </div>
            </div>
          </div>
        "#;

        let item = extract_news_item_fields(html).expect("Expected extraction result");

        assert_eq!(item.title, "2nd Gundam Hathaway Film Screens in U.S. Theaters on May 15");
        assert_eq!(item.date, "2026-03-24T16:10:21-04:00");
        assert_eq!(
            item.thumbnail,
            "https://www.animenewsnetwork.com/thumbnails/crop348x200gGH/cms/news.8/229798/kv6.png.jpg"
        );
        assert_eq!(item.snippet, "");
        assert_eq!(
            item.url,
            "https://www.animenewsnetwork.com/news/2026-03-24/2nd-gundam-hathaway-film-screens-in-u.s-theaters-on-may-15/.235700"
        );
        assert_eq!(
            item.id,
            "89db4c2e198328a709feeb14b0cc22336126a4ff1373060fa14464efcb345501"
        );
        assert_eq!(item.category, "anime");
    }

    #[test]
    fn sorts_ann_news_items_by_date_desc() {
        let mut items = vec![
            test_item(
                "older",
                "2026-03-23T09:00:00-04:00",
                "https://www.animenewsnetwork.com/news/2026-03-23/older/.1",
            ),
            test_item(
                "newest",
                "2026-03-25T08:30:00-04:00",
                "https://www.animenewsnetwork.com/news/2026-03-25/newest/.2",
            ),
            test_item(
                "fallback-url-date",
                "Mar 24, 16:10",
                "https://www.animenewsnetwork.com/news/2026-03-24/fallback/.3",
            ),
        ];

        sort_ann_news_items_by_date_desc(&mut items);

        assert_eq!(items[0].title, "newest");
        assert_eq!(items[1].title, "fallback-url-date");
        assert_eq!(items[2].title, "older");
    }

    #[test]
    fn truncates_ann_news_items_to_default_limit() {
        let mut items: Vec<_> = (0..12)
            .map(|index| {
                test_item(
                    &format!("item-{index}"),
                    "2026-03-25T08:30:00-04:00",
                    &format!("https://www.animenewsnetwork.com/news/2026-03-25/item-{index}/.{index}"),
                )
            })
            .collect();

        truncate_ann_news_items(&mut items, None);

        assert_eq!(items.len(), 10);
    }

    #[test]
    fn truncates_ann_news_items_to_requested_limit() {
        let mut items: Vec<_> = (0..12)
            .map(|index| {
                test_item(
                    &format!("item-{index}"),
                    "2026-03-25T08:30:00-04:00",
                    &format!("https://www.animenewsnetwork.com/news/2026-03-25/item-{index}/.{index}"),
                )
            })
            .collect();

        truncate_ann_news_items(&mut items, Some(3));

        assert_eq!(items.len(), 3);
    }
}
