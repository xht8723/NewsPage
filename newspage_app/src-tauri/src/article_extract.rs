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
        println!("[gnews-decode] Tier 1 offline decode succeeded: {}", url);
        Some(url.to_string())
    } else {
        println!(
            "[gnews-decode] Tier 1 decoded non-URL (likely new format): {}",
            &url[..url.len().min(30)]
        );
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
    println!("[gnews-decode] Tier 2: fetching params from {}", page_url);

    let resp = client.get(&page_url).send().await.ok()?;
    if !resp.status().is_success() {
        println!(
            "[gnews-decode] Tier 2: params fetch failed with status {}",
            resp.status()
        );
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
            None => {
                println!("[gnews-decode] Tier 2: data-n-a-sg attribute not found in HTML");
                return None;
            }
        }
    };

    println!(
        "[gnews-decode] Tier 2: got signature={}, timestamp={}",
        &signature[..signature.len().min(20)],
        timestamp
    );

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
        println!(
            "[gnews-decode] Tier 2: batchexecute failed with status {}",
            api_resp.status()
        );
        return None;
    }

    let body = api_resp.text().await.ok()?;

    // Parse response: split on "\n\n", take second part, parse JSON
    // The response format is: )]}\'\n\n<json_array>
    let decoded_url = parse_batchexecute_response(&body);
    match &decoded_url {
        Some(url) => println!("[gnews-decode] Tier 2 decoded URL: {}", url),
        None => println!("[gnews-decode] Tier 2: failed to parse batchexecute response"),
    }
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
    println!("[gnews-decode] decoding article ID: {}...", &article_id[..article_id.len().min(30)]);
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
    println!("[thumbnail] fetching article: {}", url);
    logging::info("Extract", format!("Fetching article content for {}", url), None);

    // If this is a Google News URL, decode it to the real publisher URL first.
    let effective_url = if is_google_news_url(url) {
        match decode_google_news_url(url).await {
            Some(real_url) => {
                println!("[thumbnail] decoded Google News URL -> {}", real_url);
                logging::info("Extract", "Google News redirect decoded successfully", None);
                real_url
            }
            None => {
                println!("[thumbnail] Google News URL decode failed, using original URL");
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

    println!("[thumbnail] extracting thumbnail from HTML ({} bytes):", html.len());
    logging::info(
        "Extract",
        format!("Received HTML payload ({} bytes); extracting thumbnail and body", html.len()),
        Some(html.len()),
    );
    let thumbnail = extract_thumbnail_from_html(&html, &effective_url);

    match &thumbnail {
        Some(url) => println!("[thumbnail] extracted thumbnail URL: {}", url),
        None => println!("[thumbnail] no thumbnail extracted for: {}", effective_url),
    }

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
        println!(
            "[article-extract] junk text detected for {}: {} (text: \"{}\")",
            effective_url,
            reason,
            &result.content_text[..result.content_text.len().min(120)]
        );
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
        let mut found_any = false;
        for el in document.select(&sel) {
            if let Some(url) = el.value().attr("content") {
                found_any = true;
                let url = url.trim();
                match check_image_url(url) {
                    Ok(()) => {
                        println!("[thumbnail]   og:image -> accepted: {}", url);
                        return Some(resolve(url));
                    }
                    Err(reason) => {
                        println!("[thumbnail]   og:image -> rejected ({}): {}", reason, url);
                    }
                }
            }
        }
        if !found_any {
            println!("[thumbnail]   og:image: not found");
        }
    }

    // 2. Try twitter:image
    if let Ok(sel) = Selector::parse(r#"meta[name="twitter:image"], meta[name="twitter:image:src"]"#) {
        let mut found_any = false;
        for el in document.select(&sel) {
            if let Some(url) = el.value().attr("content") {
                found_any = true;
                let url = url.trim();
                match check_image_url(url) {
                    Ok(()) => {
                        println!("[thumbnail]   twitter:image -> accepted: {}", url);
                        return Some(resolve(url));
                    }
                    Err(reason) => {
                        println!("[thumbnail]   twitter:image -> rejected ({}): {}", reason, url);
                    }
                }
            }
        }
        if !found_any {
            println!("[thumbnail]   twitter:image: not found");
        }
    }

    // 3. Try <link rel="image_src">
    if let Ok(sel) = Selector::parse(r#"link[rel="image_src"]"#) {
        let mut found_any = false;
        for el in document.select(&sel) {
            if let Some(url) = el.value().attr("href") {
                found_any = true;
                let url = url.trim();
                match check_image_url(url) {
                    Ok(()) => {
                        println!("[thumbnail]   link[image_src] -> accepted: {}", url);
                        return Some(resolve(url));
                    }
                    Err(reason) => {
                        println!("[thumbnail]   link[image_src] -> rejected ({}): {}", reason, url);
                    }
                }
            }
        }
        if !found_any {
            println!("[thumbnail]   link[image_src]: not found");
        }
    }

    // 4. Fallback: first <img> in <body>
    if let Ok(sel) = Selector::parse("body img") {
        let mut found_any = false;
        for el in document.select(&sel) {
            // Prefer src, fall back to data-src (lazy-loaded images)
            let url = el
                .value()
                .attr("src")
                .or_else(|| el.value().attr("data-src"));
            if let Some(url) = url {
                found_any = true;
                let url = url.trim();
                match check_image_url(url) {
                    Ok(()) => {
                        println!("[thumbnail]   body img -> accepted: {}", url);
                        return Some(resolve(url));
                    }
                    Err(reason) => {
                        println!("[thumbnail]   body img -> rejected ({}): {}", reason, url);
                    }
                }
            }
        }
        if !found_any {
            println!("[thumbnail]   body img: no <img> tags found in <body>");
        }
    }

    println!("[thumbnail]   result: no usable image found in HTML");
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

// ---------------------------------------------------------------------------
// Junk article text detection
// ---------------------------------------------------------------------------

/// Returns `true` if the thumbnail URL is missing or likely low quality.
pub fn is_low_quality_thumbnail(url: &Option<String>) -> bool {
    let url = match url {
        Some(u) if !u.trim().is_empty() => u,
        _ => return true, // no thumbnail
    };
    let lower = url.to_ascii_lowercase();
    let bad_patterns = [
        "placeholder", "default", "noimage", "no-image", "no_image",
        "missing", "fallback", "generic", "blank", "spacer", "logo",
        "footer", "icon", "favicon", "avatar", "badge", "banner_ad",
    ];
    for pat in &bad_patterns {
        if lower.contains(pat) {
            println!("[image-search] low quality thumbnail (contains '{}'): {}", pat, url);
            return true;
        }
    }
    false
}

/// Search DuckDuckGo Images for a relevant image based on the article title.
/// Returns the URL of the best image result, or None. No API key required.
pub async fn search_image_by_title(title: &str) -> Option<String> {
    println!("[image-search] searching DuckDuckGo for: {}", title);

    let client = build_client();
    let encoded_query = urlencoding::encode(title);

    // Step 1: Fetch the DDG search page to extract the vqd token
    let page_url = format!(
        "https://duckduckgo.com/?q={}&iax=images&ia=images",
        encoded_query
    );
    let page_resp = client
        .get(&page_url)
        .header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
        .send()
        .await
        .ok()?;

    let page_text = page_resp.text().await.ok()?;

    // Extract vqd token: appears as vqd='...' or vqd="..." or vqd=4-...
    let vqd = extract_vqd(&page_text)?;
    println!("[image-search] got vqd token: {}...", &vqd[..vqd.len().min(12)]);

    // Step 2: Query the image API
    let api_url = format!(
        "https://duckduckgo.com/i.js?l=us-en&o=json&q={}&vqd={}&f=,,,,,&p=1",
        encoded_query, vqd
    );
    let api_resp = client
        .get(&api_url)
        .header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
        .header("Referer", "https://duckduckgo.com/")
        .send()
        .await
        .ok()?;

    if !api_resp.status().is_success() {
        println!(
            "[image-search] DuckDuckGo API error: status {}",
            api_resp.status()
        );
        return None;
    }

    let body: serde_json::Value = api_resp.json().await.ok()?;
    let results = body.get("results")?.as_array()?;

    for result in results.iter().take(10) {
        let image_url = result.get("image").and_then(|v| v.as_str()).unwrap_or("");
        if image_url.is_empty() {
            continue;
        }

        let width = result
            .get("width")
            .and_then(|w| w.as_u64())
            .unwrap_or(0);
        let height = result
            .get("height")
            .and_then(|h| h.as_u64())
            .unwrap_or(0);

        // Skip small images
        if width > 0 && width < 300 {
            println!(
                "[image-search] skipping small image ({}x{}): {}",
                width, height, image_url
            );
            continue;
        }

        // Skip SVGs and data URIs
        if check_image_url(image_url).is_err() {
            continue;
        }

        println!(
            "[image-search] selected image ({}x{}): {}",
            width, height, image_url
        );
        return Some(image_url.to_string());
    }

    println!("[image-search] no suitable image found for: {}", title);
    None
}

/// Extract the vqd token from DuckDuckGo HTML page content.
fn extract_vqd(html: &str) -> Option<String> {
    // Try pattern: vqd='...' or vqd="..."
    for prefix in &["vqd='", "vqd=\""] {
        if let Some(start) = html.find(prefix) {
            let after = &html[start + prefix.len()..];
            let end_char = if *prefix == "vqd='" { '\'' } else { '"' };
            if let Some(end) = after.find(end_char) {
                return Some(after[..end].to_string());
            }
        }
    }
    // Try pattern: vqd=4-... (unquoted, ends at & or ")
    if let Some(start) = html.find("vqd=") {
        let after = &html[start + 4..];
        let end = after
            .find(|c: char| c == '&' || c == '"' || c == '\'' || c == ' ' || c == ';')
            .unwrap_or(after.len());
        if end > 0 {
            return Some(after[..end].to_string());
        }
    }
    println!("[image-search] could not extract vqd token from DuckDuckGo page");
    None
}

#[cfg(test)]
mod tests {
    use super::*;

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

        for (pattern, close_char) in &[
            ("window.location.replace(\"", '"'),
            ("window.location.replace('",  '\''),
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

    #[test]
    fn og_image_is_preferred() {
        let html = r#"
        <html><head>
            <meta property="og:image" content="https://example.com/og.jpg" />
        </head><body>
            <img src="https://example.com/body.jpg" />
        </body></html>"#;
        assert_eq!(
            extract_thumbnail_from_html(html, "https://example.com/article"),
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
            extract_thumbnail_from_html(html, "https://example.com/article"),
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
            extract_thumbnail_from_html(html, "https://example.com/article"),
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
            extract_thumbnail_from_html(html, "https://example.com/article"),
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
            extract_thumbnail_from_html(html, "https://example.com/article"),
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
            extract_thumbnail_from_html(html, "https://example.com/article"),
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
            extract_thumbnail_from_html(html, "https://example.com/article"),
            Some("https://example.com/article.jpg".to_string())
        );
    }

    #[test]
    fn twitter_image_fallback() {
        let html = r#"
        <html><head>
            <meta name="twitter:image" content="https://example.com/twitter.jpg" />
        </head><body>
            <img src="https://example.com/body.jpg" />
        </body></html>"#;
        assert_eq!(
            extract_thumbnail_from_html(html, "https://example.com/article"),
            Some("https://example.com/twitter.jpg".to_string())
        );
    }

    #[test]
    fn twitter_image_src_variant() {
        let html = r#"
        <html><head>
            <meta name="twitter:image:src" content="https://example.com/twitter2.jpg" />
        </head><body></body></html>"#;
        assert_eq!(
            extract_thumbnail_from_html(html, "https://example.com/article"),
            Some("https://example.com/twitter2.jpg".to_string())
        );
    }

    #[test]
    fn link_image_src_fallback() {
        let html = r#"
        <html><head>
            <link rel="image_src" href="https://example.com/link-img.jpg" />
        </head><body></body></html>"#;
        assert_eq!(
            extract_thumbnail_from_html(html, "https://example.com/article"),
            Some("https://example.com/link-img.jpg".to_string())
        );
    }

    #[test]
    fn og_image_preferred_over_twitter() {
        let html = r#"
        <html><head>
            <meta property="og:image" content="https://example.com/og.jpg" />
            <meta name="twitter:image" content="https://example.com/twitter.jpg" />
        </head><body></body></html>"#;
        assert_eq!(
            extract_thumbnail_from_html(html, "https://example.com/article"),
            Some("https://example.com/og.jpg".to_string())
        );
    }

    #[test]
    fn no_images_returns_none() {
        let html = r#"<html><body><p>No images here</p></body></html>"#;
        assert_eq!(extract_thumbnail_from_html(html, "https://example.com/article"), None);
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

    // --- Junk article text detection tests ---

    #[test]
    fn junk_detect_too_short() {
        assert!(is_junk_article_text("Short").is_some());
        assert!(is_junk_article_text("").is_some());
        assert!(is_junk_article_text("   ").is_some());
    }

    #[test]
    fn junk_detect_js_wall() {
        let text = "thestreet.comPlease enable JS and disable any ad blocker to view this page.";
        assert!(is_junk_article_text(text).is_some());
    }

    #[test]
    fn junk_detect_javascript_required() {
        let text = "This website requires JavaScript to function properly. Please enable JavaScript in your browser settings and try again.";
        assert!(is_junk_article_text(text).is_some());
    }

    #[test]
    fn junk_detect_captcha() {
        let text = "Please verify you are human by completing the captcha below. We need to make sure you are not a robot before proceeding.";
        assert!(is_junk_article_text(text).is_some());
    }

    #[test]
    fn junk_detect_access_denied() {
        let text = "Access denied. You do not have permission to view this resource. Please contact the site administrator if you believe this is an error.";
        assert!(is_junk_article_text(text).is_some());
    }

    #[test]
    fn junk_passes_real_article() {
        let text = "The Federal Reserve announced on Wednesday that it would hold interest rates steady, citing ongoing concerns about inflation and the labor market. Fed Chair Jerome Powell said the central bank remains committed to its dual mandate of price stability and maximum employment, and signaled that future rate decisions would depend on incoming economic data.";
        assert!(is_junk_article_text(text).is_none());
    }

    #[test]
    fn junk_passes_chinese_article() {
        let text = "新华社北京电 国务院总理在主持召开国务院常务会议时强调，要进一步优化营商环境，持续深化改革开放，推动经济高质量发展。会议研究了促进民营经济发展的若干政策措施。";
        assert!(is_junk_article_text(text).is_none());
    }

    // --- Google News URL decoder tests ---

    #[test]
    fn is_google_news_url_detects_rss() {
        assert!(is_google_news_url(
            "https://news.google.com/rss/articles/CBMiK2h0dHBz?oc=5"
        ));
    }

    #[test]
    fn is_google_news_url_detects_read() {
        assert!(is_google_news_url(
            "https://news.google.com/read/CBMiK2h0dHBz?hl=en"
        ));
    }

    #[test]
    fn is_google_news_url_rejects_normal() {
        assert!(!is_google_news_url("https://example.com/article"));
        assert!(!is_google_news_url("https://www.cnn.com/news/story"));
    }

    #[test]
    fn extract_article_id_from_rss() {
        assert_eq!(
            extract_article_id("https://news.google.com/rss/articles/CBMiK2h0dHBz?oc=5"),
            Some("CBMiK2h0dHBz")
        );
    }

    #[test]
    fn extract_article_id_no_query() {
        assert_eq!(
            extract_article_id("https://news.google.com/rss/articles/CBMiK2h0dHBz"),
            Some("CBMiK2h0dHBz")
        );
    }

    #[test]
    fn offline_decode_with_known_old_style() {
        // Encode a fake old-style article ID:
        // prefix [0x08, 0x13, 0x22] + length byte + URL + suffix [0xD2, 0x01, 0x00]
        let test_url = "https://example.com/article";
        let mut payload = vec![0x08, 0x13, 0x22];
        payload.push(test_url.len() as u8);
        payload.extend_from_slice(test_url.as_bytes());
        payload.extend_from_slice(&[0xD2, 0x01, 0x00]);

        let article_id = URL_SAFE_NO_PAD.encode(&payload);
        let decoded = decode_google_news_url_offline(&article_id);
        assert_eq!(decoded, Some(test_url.to_string()));
    }

    #[test]
    fn offline_decode_rejects_non_url() {
        // Encode a payload that decodes to something starting with "AU_yqL"
        let fake_data = "AU_yqL_some_encrypted_stuff";
        let mut payload = vec![0x08, 0x13, 0x22];
        payload.push(fake_data.len() as u8);
        payload.extend_from_slice(fake_data.as_bytes());
        payload.extend_from_slice(&[0xD2, 0x01, 0x00]);

        let article_id = URL_SAFE_NO_PAD.encode(&payload);
        let decoded = decode_google_news_url_offline(&article_id);
        assert_eq!(decoded, None);
    }

    #[test]
    fn offline_decode_long_url_two_byte_varint() {
        // URL longer than 127 bytes requires 2-byte varint length
        let test_url = format!("https://example.com/{}", "a".repeat(120));
        assert!(test_url.len() > 127);

        let mut payload = vec![0x08, 0x13, 0x22];
        let len = test_url.len();
        // Encode as 2-byte varint: low 7 bits with high bit set, then remaining bits
        payload.push((len as u8 & 0x7F) | 0x80);
        payload.push((len >> 7) as u8);
        payload.extend_from_slice(test_url.as_bytes());
        payload.extend_from_slice(&[0xD2, 0x01, 0x00]);

        let article_id = URL_SAFE_NO_PAD.encode(&payload);
        let decoded = decode_google_news_url_offline(&article_id);
        assert_eq!(decoded, Some(test_url));
    }

    #[test]
    fn parse_batchexecute_garturlres() {
        let body = r#")]}'

[["wrb.fr","Fbv4je","[\"garturlres\",\"https://www.publisher.com/real-article\",4]",null,null,null,"generic"]]"#;
        assert_eq!(
            parse_batchexecute_response(body),
            Some("https://www.publisher.com/real-article".to_string())
        );
    }
}
