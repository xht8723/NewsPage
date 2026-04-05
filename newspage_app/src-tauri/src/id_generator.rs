use sha2::{Digest, Sha256};

fn normalize_component(value: &str) -> String {
    value.trim().to_lowercase()
}

pub fn generate_article_id(url: &str, title: &str) -> String {
    let normalized_url = normalize_component(url);
    let normalized_title = normalize_component(title);

    let mut hasher = Sha256::new();
    hasher.update(normalized_url.as_bytes());
    hasher.update([0x1f]);
    hasher.update(normalized_title.as_bytes());

    format!("{:x}", hasher.finalize())
}
