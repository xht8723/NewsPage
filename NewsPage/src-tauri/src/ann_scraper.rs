use scraper::{ElementRef, Html, Selector};
use reqwest::Client;
use crate::id_generator::generate_article_id;
use crate::news_item::NewsItem;

const ANN_URL: &str = "https://www.animenewsnetwork.com/";
const ANN_NEWS_URL: &str = "https://www.animenewsnetwork.com/news/?topic=anime";

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
    })
}

#[allow(non_snake_case)]
pub async fn scrape_ANN() -> Result<Vec<AnnNewsItem>, String> {
    let news_items_html = get_news_items().await?;
    let items = news_items_html
        .iter()
        .filter_map(|item_html| extract_news_item_fields(item_html))
        .collect();

    Ok(items)
}

#[cfg(test)]
mod tests {
    use super::*;

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
        let items = scrape_ANN().await.expect("scrape_ANN failed");
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
}
