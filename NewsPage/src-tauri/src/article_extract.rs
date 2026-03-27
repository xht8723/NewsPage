use trafilatura::{extract, Options};

/// Fetches the raw HTML at `url` and extracts the main article text.
pub async fn fetch_article_text(url: &str) -> Result<String, String> {
    let html = reqwest::get(url)
        .await
        .map_err(|e| format!("Failed to fetch URL '{}': {}", url, e))?
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    let result = extract(&html, &Options::default())
        .map_err(|e| format!("trafilatura failed to extract text from '{}': {}", url, e))?;

    Ok(result.content_text)
}
