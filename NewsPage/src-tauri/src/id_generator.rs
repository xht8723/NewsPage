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

#[cfg(test)]
mod tests {
    use super::generate_article_id;

    #[test]
    fn same_input_generates_same_id() {
        let id1 = generate_article_id(
            "https://www.animenewsnetwork.com/news/2026-03-24/foo/.123",
            "Some Title",
        );
        let id2 = generate_article_id(
            "https://www.animenewsnetwork.com/news/2026-03-24/foo/.123",
            "Some Title",
        );

        assert_eq!(id1, id2);
    }

    #[test]
    fn different_input_generates_different_id() {
        let id1 = generate_article_id("https://example.com/a", "Some Title");
        let id2 = generate_article_id("https://example.com/b", "Some Title");

        assert_ne!(id1, id2);
    }

    #[test]
    fn ignores_case_and_outer_whitespace() {
        let id1 = generate_article_id(" https://example.com/a ", " Some Title ");
        let id2 = generate_article_id("https://example.com/a", "some title");

        assert_eq!(id1, id2);
    }
}
