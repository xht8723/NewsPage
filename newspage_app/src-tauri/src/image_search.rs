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

/// Fills in a missing or low-quality thumbnail by searching DuckDuckGo.
/// Mutates `thumbnail` in place if a better image is found.
pub async fn fill_thumbnail_if_missing(thumbnail: &mut String, query: &str) {
    if is_low_quality_thumbnail(&Some(thumbnail.clone())) {
        if let Some(url) = search_image_by_title(query).await {
            *thumbnail = url;
        }
    }
}

/// Search DuckDuckGo Images for a relevant image based on the article title.
/// Returns the URL of the best image result, or None. No API key required.
pub async fn search_image_by_title(title: &str) -> Option<String> {
    println!("[image-search] searching DuckDuckGo for: {}", title);

    let client = reqwest::Client::new();
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

        // Skip SVGs, data URIs, and tracking pixels
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
