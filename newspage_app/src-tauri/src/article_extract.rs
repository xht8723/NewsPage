use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use scraper::{Html, Selector};
use trafilatura::{extract, Options};

use crate::image_search::check_image_url;
use crate::logging;

const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// ---------------------------------------------------------------------------
// Google News URL decoder
// ---------------------------------------------------------------------------

/// Returns `true` if this looks like a Google News article redirect URL.
fn is_google_news_url(url: &str) -> bool {
    url.contains("news.google.com/rss/articles/")
        || url.contains("news.google.com/articles/")
        || url.contains("news.google.com/read/")
}

/// Extract the base64 article ID from a Google News URL.
fn extract_article_id(url: &str) -> Option<&str> {
    // The ID is the last path segment, possibly followed by query params
    let path = url.split('?').next()?;
    path.rsplit('/').next().filter(|s| !s.is_empty())
}

/// Tier 1: Try to decode the URL offline via base64 + protobuf parsing.
/// Works for old-style Google News URLs where the real URL is embedded directly.
fn decode_google_news_url_offline(article_id: &str) -> Option<String> {
    // base64url decode (the engine handles missing padding)
    let decoded = URL_SAFE_NO_PAD.decode(article_id).ok()?;

    // Expected protobuf prefix: field 1 varint=19, field 4 length-delimited
    let prefix: &[u8] = &[0x08, 0x13, 0x22];
    let suffix: &[u8] = &[0xD2, 0x01, 0x00];

    let mut data = decoded.as_slice();

    // Strip prefix if present
    if data.starts_with(prefix) {
        data = &data[prefix.len()..];
    } else {
        return None;
    }

    // Strip suffix if present
    if data.ends_with(suffix) {
        data = &data[..data.len() - suffix.len()];
    }

    if data.is_empty() {
        return None;
    }

    // Read length (varint: 1 or 2 bytes)
    let (length, offset) = if data[0] >= 0x80 {
        // Two-byte varint
        if data.len() < 2 {
            return None;
        }
        let len = ((data[0] as usize) & 0x7F) | ((data[1] as usize) << 7);
        (len, 2)
    } else {
        (data[0] as usize, 1)
    };

    if data.len() < offset + length {
        return None;
    }

    let url_bytes = &data[offset..offset + length];
    let url = std::str::from_utf8(url_bytes).ok()?;

    if url.starts_with("http://") || url.starts_with("https://") {
        Some(url.to_string())
    } else {
        None
    }
}

/// Tier 2: Use Google's batchexecute API with signature + timestamp.
/// Requires 2 HTTP requests: one to get params, one to decode.
async fn decode_google_news_url_api(article_id: &str) -> Option<String> {
    let client = build_client();

    // Step 1: Fetch the redirect page to extract signature and timestamp.
    // Using /rss/articles/ reportedly reduces 429 rate limiting.
    let page_url = format!(
        "https://news.google.com/rss/articles/{}",
        article_id
    );

    let resp = client.get(&page_url).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let html = resp.text().await.ok()?;

    // Parse out data-n-a-sg (signature) and data-n-a-ts (timestamp)
    // Scoped so `document` (which is !Send) drops before the next .await
    let (signature, timestamp) = {
        let document = Html::parse_document(&html);
        let sel = Selector::parse("[data-n-a-sg]").ok()?;
        let el = document.select(&sel).next();
        match el {
            Some(el) => {
                let sig = el.value().attr("data-n-a-sg")?.to_string();
                let ts = el.value().attr("data-n-a-ts")?.to_string();
                (sig, ts)
            }
            None => return None,
        }
    };

    // Step 2: Call batchexecute API
    let inner_payload = format!(
        r#"[[["Fbv4je","[\"garturlreq\",[[\"X\",\"X\",[\"X\",\"X\"],null,null,1,1,\"US:en\",null,1,null,null,null,null,null,0,1],\"X\",\"X\",1,[1,1,1],1,1,null,0,0,null,0],\"{}\",{},\"{}\"]",null,"generic"]]]"#,
        article_id, timestamp, signature
    );
    let encoded = format!("f.req={}", urlencoding::encode(&inner_payload));

    let api_resp = client
        .post("https://news.google.com/_/DotsSplashUi/data/batchexecute")
        .header("Content-Type", "application/x-www-form-urlencoded;charset=UTF-8")
        .body(encoded)
        .send()
        .await
        .ok()?;

    if !api_resp.status().is_success() {
        return None;
    }

    let body = api_resp.text().await.ok()?;

    // Parse response: split on "\n\n", take second part, parse JSON
    // The response format is: )]}\'\n\n<json_array>
    let decoded_url = parse_batchexecute_response(&body);
    decoded_url
}

/// Parse the batchexecute API response to extract the decoded article URL.
fn parse_batchexecute_response(body: &str) -> Option<String> {
    // Response has multiple lines. We need to find the JSON payload.
    // Look for the "garturlres" marker or parse the nested JSON structure.
    // Format: after ")]}'" and blank lines, there's a JSON array.

    // Strategy: find the URL between [\"garturlres\",\" and \",
    // This is simpler and more robust than nested JSON parsing.
    let marker = r#"[\"garturlres\",\""#;
    if let Some(start) = body.find(marker) {
        let rest = &body[start + marker.len()..];
        if let Some(end) = rest.find(r#"\","#) {
            let url = &rest[..end];
            if url.starts_with("http://") || url.starts_with("https://") {
                return Some(url.to_string());
            }
        }
    }

    // Fallback: try parsing the JSON structure
    // Split on double newline, parse as nested JSON
    for chunk in body.split("\n\n") {
        let trimmed = chunk.trim();
        // Skip the )]}' prefix line
        if trimmed.starts_with(")]}'") || trimmed.is_empty() {
            continue;
        }
        // Try to parse as JSON array
        if let Ok(outer) = serde_json::from_str::<serde_json::Value>(trimmed) {
            // Navigate: outer[0][2] is a JSON string containing inner array
            if let Some(inner_str) = outer.get(0).and_then(|v| v.get(2)).and_then(|v| v.as_str()) {
                if let Ok(inner) = serde_json::from_str::<serde_json::Value>(inner_str) {
                    if let Some(url) = inner.get(1).and_then(|v| v.as_str()) {
                        if url.starts_with("http://") || url.starts_with("https://") {
                            return Some(url.to_string());
                        }
                    }
                }
            }
        }
    }

    None
}

/// Decode a Google News URL to the real publisher article URL.
/// Tries offline decode first, falls back to API-based decode.
pub async fn decode_google_news_url(url: &str) -> Option<String> {
    if !is_google_news_url(url) {
        return None;
    }

    let article_id = extract_article_id(url)?;
    logging::info(
        "Extract",
        format!("Decoding Google News redirect id {}", &article_id[..article_id.len().min(30)]),
        None,
    );

    // Tier 1: offline decode (instant, no network)
    if let Some(decoded) = decode_google_news_url_offline(article_id) {
        return Some(decoded);
    }

    // Tier 2: API-based decode (2 HTTP requests)
    decode_google_news_url_api(article_id).await
}

fn build_client() -> reqwest::Client {
    use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, ACCEPT_ENCODING, ACCEPT_LANGUAGE};
    let mut headers = HeaderMap::new();
    headers.insert(
        ACCEPT,
        HeaderValue::from_static(
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        ),
    );
    headers.insert(
        ACCEPT_LANGUAGE,
        HeaderValue::from_static("zh-CN,zh;q=0.9,en;q=0.8"),
    );
    headers.insert(
        ACCEPT_ENCODING,
        HeaderValue::from_static("gzip, deflate, br"),
    );
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .default_headers(headers)
        .build()
        .unwrap_or_default()
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
    logging::info("Extract", format!("Fetching article content for {}", url), None);

    // If this is a Google News URL, decode it to the real publisher URL first.
    let effective_url = if is_google_news_url(url) {
        match decode_google_news_url(url).await {
            Some(real_url) => {
                logging::info("Extract", "Google News redirect decoded successfully", None);
                real_url
            }
            None => {
                logging::warn("Extract", "Google News redirect decode failed; using original URL", None);
                url.to_string()
            }
        }
    } else {
        url.to_string()
    };

    let response = build_client()
        .get(&effective_url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch URL '{}': {}", effective_url, e))?;

    let html = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    logging::info(
        "Extract",
        format!("Received HTML payload ({} bytes); extracting thumbnail and body", html.len()),
        Some(html.len()),
    );
    let thumbnail = extract_thumbnail_from_html(&html, &effective_url);

    logging::info(
        "Extract",
        format!(
            "Thumbnail extraction result for {}: {}",
            effective_url,
            if thumbnail.is_some() { "found" } else { "missing" }
        ),
        None,
    );

    let result = extract(&html, &Options::default())
        .map_err(|e| format!("trafilatura failed to extract text from '{}': {}", effective_url, e))?;

    // Check if the extracted text is junk (JS wall, paywall, anti-bot, etc.)
    if let Some(reason) = is_junk_article_text(&result.content_text) {
        logging::warn(
            "Extract",
            format!("Junk article text detected for {}: {}", effective_url, reason),
            None,
        );
        return Err(format!(
            "Extracted text from '{}' is not usable: {}",
            effective_url, reason
        ));
    }

    logging::info(
        "Extract",
        format!("Article text extracted for {}", effective_url),
        Some(result.content_text.len()),
    );

    Ok((result.content_text, thumbnail))
}

/// Extract a thumbnail URL from raw HTML.
///
/// Priority: `og:image` meta tag → first `<img>` in `<body>`.
/// Filters out data URIs, SVGs, tracking pixels, and Google News logos.
pub fn extract_thumbnail_from_html(html: &str, base_url: &str) -> Option<String> {
    let document = Html::parse_document(html);

    // Helper: resolve relative/protocol-relative URLs against the article URL
    let resolve = |raw_url: &str| -> String {
        let trimmed = raw_url.trim();
        if trimmed.starts_with("//") {
            return format!("https:{}", trimmed);
        }
        if trimmed.starts_with("http://") || trimmed.starts_with("https://") || trimmed.starts_with("data:") {
            return trimmed.to_string();
        }
        // Relative URL — resolve against base
        if let Ok(base) = reqwest::Url::parse(base_url) {
            if let Ok(resolved) = base.join(trimmed) {
                return resolved.to_string();
            }
        }
        trimmed.to_string()
    };

    // 1. Try og:image
    if let Ok(sel) = Selector::parse(r#"meta[property="og:image"]"#) {
        for el in document.select(&sel) {
            if let Some(url) = el.value().attr("content") {
                let url = url.trim();
                if check_image_url(url).is_ok() {
                    return Some(resolve(url));
                }
            }
        }
    }

    // 2. Try twitter:image
    if let Ok(sel) = Selector::parse(r#"meta[name="twitter:image"], meta[name="twitter:image:src"]"#) {
        for el in document.select(&sel) {
            if let Some(url) = el.value().attr("content") {
                let url = url.trim();
                if check_image_url(url).is_ok() {
                    return Some(resolve(url));
                }
            }
        }
    }

    // 3. Try <link rel="image_src">
    if let Ok(sel) = Selector::parse(r#"link[rel="image_src"]"#) {
        for el in document.select(&sel) {
            if let Some(url) = el.value().attr("href") {
                let url = url.trim();
                if check_image_url(url).is_ok() {
                    return Some(resolve(url));
                }
            }
        }
    }

    // 4. Fallback: first <img> in <body>
    if let Ok(sel) = Selector::parse("body img") {
        for el in document.select(&sel) {
            // Prefer src, fall back to data-src (lazy-loaded images)
            let url = el
                .value()
                .attr("src")
                .or_else(|| el.value().attr("data-src"));
            if let Some(url) = url {
                let url = url.trim();
                if check_image_url(url).is_ok() {
                    return Some(resolve(url));
                }
            }
        }
    }

    None
}

// ---------------------------------------------------------------------------
// Junk article text detection
// ---------------------------------------------------------------------------

const MIN_ARTICLE_TEXT_LEN: usize = 80;

/// Phrases that indicate the fetched HTML was a JS wall, paywall, anti-bot
/// page, or other non-article content.  Checked case-insensitively against
/// the extracted text.
const JUNK_PHRASES: &[&str] = &[
    "enable javascript",
    "enable js",
    "disable any ad blocker",
    "disable ad blocker",
    "disable your ad blocker",
    "turn off your ad blocker",
    "turn off ad blocker",
    "javascript is required",
    "javascript is disabled",
    "javascript is not enabled",
    "requires javascript",
    "you need to enable javascript",
    "browser does not support javascript",
    "subscribe to continue reading",
    "subscribe to read",
    "access denied",
    "403 forbidden",
    "verify you are human",
    "verify you are not a robot",
    "complete the captcha",
    "checking your browser",
    "just a moment...",
];

/// Returns `Some(reason)` if the extracted article text looks like junk
/// (JS wall, paywall, anti-bot page, etc.), or `None` if it looks legit.
pub fn is_junk_article_text(text: &str) -> Option<&'static str> {
    let trimmed = text.trim();
    if trimmed.len() < MIN_ARTICLE_TEXT_LEN {
        return Some("extracted text too short (< 80 chars)");
    }
    let lower = trimmed.to_ascii_lowercase();
    for phrase in JUNK_PHRASES {
        if lower.contains(phrase) {
            return Some("extracted text contains JS wall / paywall / anti-bot phrase");
        }
    }
    None
}
