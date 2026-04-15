use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use once_cell::sync::Lazy;
use tokio::sync::{RwLock, Semaphore};

use crate::logging;

const DDG_CONCURRENCY: usize = 3;
const DDG_TIMEOUT_SECS: u64 = 10;
const VQD_CACHE_TTL: Duration = Duration::from_secs(300);
const RATE_LIMIT_RETRY_AFTER: Duration = Duration::from_secs(2);

static DDG_SEMAPHORE: Lazy<Semaphore> = Lazy::new(|| Semaphore::new(DDG_CONCURRENCY));

static VQD_CACHE: Lazy<RwLock<HashMap<String, (String, Instant)>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));

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

pub async fn should_fallback_to_ddg(url: &str) -> bool {
    if is_low_quality_thumbnail(url) {
        return true;
    }

    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
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
        Err(e) => {
            logging::warn("DDG", format!("HEAD check failed for {}: {}", url, e), None);
            true
        }
    }
}

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

pub async fn search_image_by_title(title: &str) -> Vec<String> {
    let _permit = DDG_SEMAPHORE.acquire().await.unwrap();

    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(DDG_TIMEOUT_SECS))
        .build()
    {
        Ok(c) => Arc::new(c),
        Err(e) => {
            logging::warn("DDG", format!("Failed to build HTTP client: {}", e), None);
            return Vec::new();
        }
    };
    let encoded_query = urlencoding::encode(title);

    let vqd = match get_vqd(&client, title, &encoded_query).await {
        Some(v) => v,
        None => return Vec::new(),
    };

    let api_url = format!(
        "https://duckduckgo.com/i.js?l=us-en&o=json&q={}&vqd={}&f=,,,,,&p=1",
        encoded_query, vqd
    );

    let api_resp = match send_with_retry(client.clone(), &api_url, true).await {
        Ok(r) => r,
        Err(e) => {
            logging::warn("DDG", format!("API request failed for '{}': {}", title, e), None);
            return Vec::new();
        }
    };

    if !api_resp.status().is_success() {
        let status = api_resp.status();
        if status.as_u16() == 429 {
            logging::warn("DDG", format!("Rate limited on API call for '{}' (after retry)", title), None);
        } else {
            logging::warn("DDG", format!("API returned {} for '{}'", status, title), None);
        }
        return Vec::new();
    }

    let body: serde_json::Value = match api_resp.json().await {
        Ok(v) => v,
        Err(e) => {
            logging::warn("DDG", format!("JSON parse error for '{}': {}", title, e), None);
            return Vec::new();
        }
    };
    let results = match body.get("results").and_then(|v| v.as_array()) {
        Some(r) => r,
        None => {
            logging::warn("DDG", format!("No 'results' array in response for '{}'", title), None);
            return Vec::new();
        }
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

    if candidates.is_empty() {
        logging::warn("DDG", format!("No usable image candidates for '{}'", title), None);
    }

    candidates
}

async fn get_vqd(
    client: &Arc<reqwest::Client>,
    title: &str,
    encoded_query: &str,
) -> Option<String> {
    {
        let cache = VQD_CACHE.read().await;
        if let Some((vqd, inserted)) = cache.get(title) {
            if inserted.elapsed() < VQD_CACHE_TTL {
                return Some(vqd.clone());
            }
        }
    }

    let page_url = format!(
        "https://duckduckgo.com/?q={}&iax=images&ia=images",
        encoded_query
    );

    let page_resp = match send_with_retry(client.clone(), &page_url, false).await {
        Ok(r) => r,
        Err(e) => {
            logging::warn("DDG", format!("Page request failed for '{}': {}", title, e), None);
            return None;
        }
    };

    if !page_resp.status().is_success() {
        let status = page_resp.status();
        if status.as_u16() == 429 {
            logging::warn("DDG", format!("Rate limited on page fetch for '{}' (after retry)", title), None);
        } else {
            logging::warn("DDG", format!("Page fetch returned {} for '{}'", status, title), None);
        }
        return None;
    }

    let page_text = match page_resp.text().await {
        Ok(t) => t,
        Err(e) => {
            logging::warn("DDG", format!("Failed to read page body for '{}': {}", title, e), None);
            return None;
        }
    };

    let vqd = match extract_vqd(&page_text) {
        Some(v) => v,
        None => {
            logging::warn("DDG", format!("Failed to extract vqd token for '{}'", title), None);
            return None;
        }
    };

    {
        let mut cache = VQD_CACHE.write().await;
        cache.retain(|_, (_, inserted)| inserted.elapsed() < VQD_CACHE_TTL);
        cache.insert(title.to_string(), (vqd.clone(), Instant::now()));
    }

    Some(vqd)
}

async fn send_with_retry(
    client: Arc<reqwest::Client>,
    url: &str,
    with_referer: bool,
) -> Result<reqwest::Response, String> {
    let build_request = || {
        let mut req = client
            .get(url)
            .header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36");
        if with_referer {
            req = req.header("Referer", "https://duckduckgo.com/");
        }
        req
    };

    let resp = match build_request().send().await {
        Ok(r) => r,
        Err(e) => return Err(format!("Network error: {}", e)),
    };

    if resp.status().as_u16() == 429 {
        let wait = resp
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok())
            .map(Duration::from_secs)
            .unwrap_or(RATE_LIMIT_RETRY_AFTER);

        logging::warn("DDG", format!("Rate limited (429) on {}, waiting {:?}", url, wait), None);
        tokio::time::sleep(wait).await;

        match build_request().send().await {
            Ok(r) => Ok(r),
            Err(e) => Err(format!("Network error on retry: {}", e)),
        }
    } else {
        Ok(resp)
    }
}

fn extract_vqd(html: &str) -> Option<String> {
    for prefix in &["vqd='", "vqd=\""] {
        if let Some(start) = html.find(prefix) {
            let after = &html[start + prefix.len()..];
            let end_char = if *prefix == "vqd='" { '\'' } else { '"' };
            if let Some(end) = after.find(end_char) {
                return Some(after[..end].to_string());
            }
        }
    }
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
