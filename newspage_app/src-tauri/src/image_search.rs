/// Returns `Ok(())` if the URL looks like a real article image, or
/// `Err(reason)` explaining why it was rejected.
pub(crate) fn check_image_url(url: &str) -> Result<(), &'static str> {
    if url.is_empty() {
        return Err("empty URL");
    }
    if url.starts_with("data:") {
        return Err("data URI");
    }
    if url.ends_with(".svg") || url.contains(".svg?") {
        return Err("SVG file");
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
        return Err("tracking pixel");
    }
    if url.contains("news.google.com") {
        return Err("Google News URL");
    }
    if url.contains("lh3.googleusercontent.com") && !url.contains("blogspot") {
        return Err("Google News logo (lh3.googleusercontent.com)");
    }
    Ok(())
}

/// Returns `true` if the thumbnail URL is missing or likely low quality.
pub fn is_low_quality_thumbnail(url: &str) -> bool {
    let url = match url.trim() {
        u if !u.is_empty() => u,
        _ => return true,
    };
    let lower = url.to_ascii_lowercase();
    let bad_patterns = [
        "placeholder", "default", "noimage", "no-image", "no_image",
        "missing", "fallback", "generic", "blank", "spacer", "logo",
        "footer", "icon", "favicon", "avatar", "badge", "banner_ad",
    ];
    for pat in &bad_patterns {
        if lower.contains(pat) {
            return true;
        }
    }
    false
}

/// Async check combining URL pattern heuristics with a HEAD request to
/// verify the image is not suspiciously small (<10 KB).
/// Returns `true` when the thumbnail should be replaced via DDG search.
pub async fn should_fallback_to_ddg(url: &str) -> bool {
    if is_low_quality_thumbnail(url) {
        return true;
    }

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build()
    {
        Ok(c) => c,
        Err(_) => return true,
    };

    let resolved = if url.starts_with("//") {
        format!("https:{}", url)
    } else {
        url.to_string()
    };

    if !(resolved.starts_with("http://") || resolved.starts_with("https://")) {
        return true;
    }

    match client.head(&resolved).send().await {
        Ok(resp) => {
            let content_length = resp
                .headers()
                .get(reqwest::header::CONTENT_LENGTH)
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse::<u64>().ok());

            match content_length {
                Some(len) => len < 10_240,
                None => false,
            }
        }
        Err(_) => true,
    }
}

/// Fills in a missing or low-quality thumbnail by searching DuckDuckGo.
/// Returns candidate image URLs (best first). Mutates `thumbnail` to the
/// first candidate so callers that don't need fallbacks still work.
pub async fn fill_thumbnail_if_missing(thumbnail: &mut String, query: &str) -> Vec<String> {
    if should_fallback_to_ddg(thumbnail).await {
        let candidates = search_image_by_title(query).await;
        if let Some(first) = candidates.first() {
            *thumbnail = first.clone();
        }
        candidates
    } else {
        Vec::new()
    }
}

/// Search DuckDuckGo Images for a relevant image based on the article title.
/// Returns a list of candidate image URLs (best first). No API key required.
pub async fn search_image_by_title(title: &str) -> Vec<String> {
    let client = reqwest::Client::new();
    let encoded_query = urlencoding::encode(title);

    let page_url = format!(
        "https://duckduckgo.com/?q={}&iax=images&ia=images",
        encoded_query
    );
    let page_resp = match client
        .get(&page_url)
        .header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
        .send()
        .await
    {
        Ok(r) => r,
        Err(_) => return Vec::new(),
    };

    let page_text = match page_resp.text().await {
        Ok(t) => t,
        Err(_) => return Vec::new(),
    };

    let vqd = match extract_vqd(&page_text) {
        Some(v) => v,
        None => return Vec::new(),
    };

    let api_url = format!(
        "https://duckduckgo.com/i.js?l=us-en&o=json&q={}&vqd={}&f=,,,,,&p=1",
        encoded_query, vqd
    );
    let api_resp = match client
        .get(&api_url)
        .header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
        .header("Referer", "https://duckduckgo.com/")
        .send()
        .await
    {
        Ok(r) => r,
        Err(_) => return Vec::new(),
    };

    if !api_resp.status().is_success() {
        return Vec::new();
    }

    let body: serde_json::Value = match api_resp.json().await {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    let results = match body.get("results").and_then(|v| v.as_array()) {
        Some(r) => r,
        None => return Vec::new(),
    };

    let mut candidates = Vec::new();

    for result in results.iter().take(10) {
        let image_url = result.get("image").and_then(|v| v.as_str()).unwrap_or("");
        if image_url.is_empty() {
            continue;
        }

        let width = result
            .get("width")
            .and_then(|w| w.as_u64())
            .unwrap_or(0);
        if width > 0 && width < 300 {
            continue;
        }

        if check_image_url(image_url).is_err() {
            continue;
        }

        candidates.push(image_url.to_string());
    }

    candidates
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
    None
}
