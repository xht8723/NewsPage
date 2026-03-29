use scraper::{Html, Selector};
use trafilatura::{extract, Options};

const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

fn build_client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .unwrap_or_default()
}

/// Fetches the raw HTML at `url` and extracts the main article text.
pub async fn fetch_article_text(url: &str) -> Result<String, String> {
    let html = build_client()
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch URL '{}': {}", url, e))?
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    let result = extract(&html, &Options::default())
        .map_err(|e| format!("trafilatura failed to extract text from '{}': {}", url, e))?;

    Ok(result.content_text)
}

/// Fetches the raw HTML at `url` and extracts both the main article text and
/// a thumbnail URL (og:image or first body `<img>`).
///
/// Google News RSS article URLs often land on an intermediary page rather than
/// the publisher's article. When that happens, the function resolves the real
/// article URL and re-fetches so that thumbnail and text extraction operate on
/// the actual article HTML.
pub async fn fetch_article_text_and_thumbnail(
    url: &str,
) -> Result<(String, Option<String>), String> {
    let response = build_client()
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch URL '{}': {}", url, e))?;

    let landed_on_google = response
        .url()
        .host_str()
        .map(|host| host.contains("google.com") || host.contains("google.ca"))
        .unwrap_or(false);

    let html = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    let effective_html = if landed_on_google {
        resolve_and_fetch_redirect(&html).await.unwrap_or(html)
    } else {
        html
    };

    let thumbnail = extract_thumbnail_from_html(&effective_html);

    let result = extract(&effective_html, &Options::default())
        .map_err(|e| format!("trafilatura failed to extract text from '{}': {}", url, e))?;

    Ok((result.content_text, thumbnail))
}

async fn resolve_and_fetch_redirect(html: &str) -> Option<String> {
    let real_url = resolve_redirect_url(html)?;
    println!("[thumbnail] resolved redirect -> {}", real_url);

    let response = build_client().get(&real_url).send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }

    response.text().await.ok()
}

fn resolve_redirect_url(html: &str) -> Option<String> {
    let document = Html::parse_document(html);

    if let Ok(sel) = Selector::parse("meta[http-equiv]") {
        for el in document.select(&sel) {
            let equiv = el.value().attr("http-equiv").unwrap_or("");
            if !equiv.eq_ignore_ascii_case("refresh") {
                continue;
            }

            if let Some(content) = el.value().attr("content") {
                if let Some(url) = parse_meta_refresh_url(content) {
                    return Some(url);
                }
            }
        }
    }

    if let Ok(sel) = Selector::parse("[data-n-au]") {
        for el in document.select(&sel) {
            if let Some(url) = el.value().attr("data-n-au") {
                let url = url.trim();
                if url.starts_with("http://") || url.starts_with("https://") {
                    return Some(url.to_string());
                }
            }
        }
    }

    // Match both double-quote and single-quote JS redirect variants.
    for (pattern, close_char) in &[
        ("window.location.replace(\"", '"'),
        ("window.location.replace('" , '\''),
        ("window.location.href=\"",    '"'),
        ("window.location.href = \"",  '"'),
        ("window.location.href='",     '\''),
        ("window.location.href = '",   '\''),
        ("window.location=\"",         '"'),
        ("window.location = \"",       '"'),
        ("window.location='",          '\''),
        ("window.location = '",        '\''),
    ] {
        if let Some(index) = html.find(pattern) {
            let rest = &html[index + pattern.len()..];
            if let Some(end) = rest.find(*close_char) {
                let url = &rest[..end];
                if url.starts_with("http://") || url.starts_with("https://") {
                    return Some(url.to_string());
                }
            }
        }
    }

    None
}

fn parse_meta_refresh_url(content: &str) -> Option<String> {
    let lower = content.to_ascii_lowercase();
    let index = lower.find("url=")?;
    let url = content[index + 4..]
        .trim()
        .trim_matches(|c: char| c == '"' || c == '\'');

    if url.starts_with("http://") || url.starts_with("https://") {
        Some(url.to_string())
    } else {
        None
    }
}

/// Extract a thumbnail URL from raw HTML.
///
/// Priority: `og:image` meta tag → first `<img>` in `<body>`.
/// Filters out data URIs, SVGs, tracking pixels, and Google News logos.
pub fn extract_thumbnail_from_html(html: &str) -> Option<String> {
    let document = Html::parse_document(html);

    // 1. Try og:image
    if let Ok(sel) = Selector::parse(r#"meta[property="og:image"]"#) {
        for el in document.select(&sel) {
            if let Some(url) = el.value().attr("content") {
                let url = url.trim();
                if is_usable_image_url(url) {
                    return Some(url.to_string());
                }
            }
        }
    }

    // 2. Fallback: first <img> in <body>
    if let Ok(sel) = Selector::parse("body img") {
        for el in document.select(&sel) {
            // Prefer src, fall back to data-src (lazy-loaded images)
            let url = el
                .value()
                .attr("src")
                .or_else(|| el.value().attr("data-src"));
            if let Some(url) = url {
                let url = url.trim();
                if is_usable_image_url(url) {
                    return Some(url.to_string());
                }
            }
        }
    }

    None
}

/// Returns `true` if the URL looks like a real article image (not a tracker,
/// data URI, SVG icon, or Google News logo).
fn is_usable_image_url(url: &str) -> bool {
    if url.is_empty() {
        return false;
    }
    if url.starts_with("data:") {
        return false;
    }
    if url.ends_with(".svg") || url.contains(".svg?") {
        return false;
    }
    // Reject obvious 1×1 tracking pixel URLs (not just any URL that mentions the word).
    // Match patterns like: /pixel.gif, /1x1.gif, ?width=1&height=1,
    // tracking pixel paths (/tp/, /t.gif), but NOT legitimate images about e.g. Google Pixel.
    let lower_url = url.to_ascii_lowercase();
    if lower_url.ends_with("/pixel.gif")
        || lower_url.ends_with("/pixel.png")
        || lower_url.ends_with("/spacer.gif")
        || lower_url.ends_with("/spacer.png")
        || lower_url.contains("/1x1")
        || lower_url.contains("1x1.gif")
        || lower_url.contains("1x1.png")
        || lower_url.contains("clear.gif")
        || lower_url.contains("blank.gif")
    {
        return false;
    }
    if url.contains("news.google.com") {
        return false;
    }
    if url.contains("lh3.googleusercontent.com") && !url.contains("blogspot") {
        return false;
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn og_image_is_preferred() {
        let html = r#"
        <html><head>
            <meta property="og:image" content="https://example.com/og.jpg" />
        </head><body>
            <img src="https://example.com/body.jpg" />
        </body></html>"#;
        assert_eq!(
            extract_thumbnail_from_html(html),
            Some("https://example.com/og.jpg".to_string())
        );
    }

    #[test]
    fn falls_back_to_body_img() {
        let html = r#"
        <html><head><title>No OG</title></head><body>
            <img src="https://example.com/photo.jpg" />
        </body></html>"#;
        assert_eq!(
            extract_thumbnail_from_html(html),
            Some("https://example.com/photo.jpg".to_string())
        );
    }

    #[test]
    fn data_src_lazy_loading() {
        let html = r#"
        <html><body>
            <img data-src="https://example.com/lazy.jpg" />
        </body></html>"#;
        assert_eq!(
            extract_thumbnail_from_html(html),
            Some("https://example.com/lazy.jpg".to_string())
        );
    }

    #[test]
    fn filters_data_uri() {
        let html = r#"
        <html><head>
            <meta property="og:image" content="data:image/gif;base64,R0lGODlh" />
        </head><body>
            <img src="https://example.com/real.png" />
        </body></html>"#;
        assert_eq!(
            extract_thumbnail_from_html(html),
            Some("https://example.com/real.png".to_string())
        );
    }

    #[test]
    fn filters_svg() {
        let html = r#"
        <html><body>
            <img src="https://example.com/icon.svg" />
            <img src="https://example.com/photo.webp" />
        </body></html>"#;
        assert_eq!(
            extract_thumbnail_from_html(html),
            Some("https://example.com/photo.webp".to_string())
        );
    }

    #[test]
    fn filters_tracking_pixel() {
        let html = r#"
        <html><body>
            <img src="https://tracker.com/1x1.gif" />
            <img src="https://example.com/hero.jpg" />
        </body></html>"#;
        assert_eq!(
            extract_thumbnail_from_html(html),
            Some("https://example.com/hero.jpg".to_string())
        );
    }

    #[test]
    fn filters_google_news_logo() {
        let html = r#"
        <html><head>
            <meta property="og:image" content="https://lh3.googleusercontent.com/-DR60l-K8vnyi/logo.png" />
        </head><body>
            <img src="https://example.com/article.jpg" />
        </body></html>"#;
        assert_eq!(
            extract_thumbnail_from_html(html),
            Some("https://example.com/article.jpg".to_string())
        );
    }

    #[test]
    fn no_images_returns_none() {
        let html = r#"<html><body><p>No images here</p></body></html>"#;
        assert_eq!(extract_thumbnail_from_html(html), None);
    }

    #[test]
    fn resolve_meta_refresh() {
        let html = r#"<html><head>
            <meta http-equiv="refresh" content="0;url=https://www.example.com/article" />
        </head><body></body></html>"#;
        assert_eq!(
            resolve_redirect_url(html),
            Some("https://www.example.com/article".to_string())
        );
    }

    #[test]
    fn resolve_js_redirect() {
        let html = r#"<html><head><script>window.location.replace("https://www.example.com/news")</script></head></html>"#;
        assert_eq!(
            resolve_redirect_url(html),
            Some("https://www.example.com/news".to_string())
        );
    }

    #[test]
    fn resolve_data_n_au() {
        let html = r#"<html><body><a data-n-au="https://publisher.com/story">Read</a></body></html>"#;
        assert_eq!(
            resolve_redirect_url(html),
            Some("https://publisher.com/story".to_string())
        );
    }

    #[test]
    fn resolve_returns_none_for_normal_page() {
        let html = r#"<html><head><title>Normal</title></head><body><p>Hello</p></body></html>"#;
        assert_eq!(resolve_redirect_url(html), None);
    }
}
