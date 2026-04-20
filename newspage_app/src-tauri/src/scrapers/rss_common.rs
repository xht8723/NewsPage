use chrono::{DateTime, Utc};
use reqwest::Client;

use crate::id_generator::generate_article_id;
use crate::article::Article;

/// Shared RSS item model for scraper stages.
pub struct RssItem {
    pub title: String,
    pub link: String,
    pub pub_date: String,
    pub pub_date_parsed: Option<DateTime<Utc>>,
    pub source_name: String,
    pub source_icon: String,
    pub thumbnail: String,
}

/// Extract text between the first `<tag...>` and `</tag>` in `xml`.
pub fn xml_tag_content<'a>(xml: &'a str, tag: &str) -> Option<&'a str> {
    let open = format!("<{}", tag);
    let close = format!("</{}>", tag);
    let start = xml.find(&open)?;
    let after_open = &xml[start + open.len()..];
    let content_start = after_open.find('>')? + 1;
    let content = &after_open[content_start..];
    let end = content.find(&close)?;
    Some(content[..end].trim())
}

pub fn strip_cdata(s: &str) -> String {
    let s = s.trim();
    if let Some(inner) = s.strip_prefix("<![CDATA[") {
        inner.strip_suffix("]]>").unwrap_or(inner).trim().to_string()
    } else {
        s.to_string()
    }
}

/// Decode a small set of common HTML/XML entities.
pub fn decode_entities(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
}

/// Strip a trailing source name appended by Google News RSS.
///
/// Google News titles look like `\"Article Title - Source Name\"` or
/// `\"Article Title | Source Name\"`. This function removes the last
/// occurrence of ` - `, ` | `, or ` \u{2013} ` (en-dash) and everything
/// after it, returning the trimmed article title.
///
/// If none of the separators are found the original title is returned
/// unchanged, so non-Google-News feeds are unaffected.
pub fn strip_trailing_source(title: &str) -> String {
    // Separators to look for (we pick the rightmost/last occurrence).
    // U+2013 = en dash, U+2014 = em dash — both appear in real feeds.
    const SEPARATORS: &[&str] = &[" - ", " | ", " \u{2013} ", " \u{2014} "];
    let mut best: Option<usize> = None;
    let mut best_sep_len = 0usize;
    for sep in SEPARATORS {
        if let Some(pos) = title.rfind(sep) {
            if best.map_or(true, |b| pos > b) {
                best = Some(pos);
                best_sep_len = sep.len();
            }
        }
    }
    match best {
        Some(pos) => {
            let suffix = &title[pos + best_sep_len..];
            // Sanity check: suffix must be non-empty and must not itself
            // contain another separator (which would mean this was a
            // mid-title dash, not a trailing source label).
            let suspicious = SEPARATORS.iter().any(|s| suffix.contains(s));
            if suffix.is_empty() || suspicious {
                title.to_string()
            } else {
                title[..pos].trim().to_string()
            }
        }
        None => title.to_string(),
    }
}

/// Parse the `<source url="...">SourceName</source>` tag.
fn parse_source_tag(item_xml: &str) -> (String, String) {
    let tag = "source";
    let open = format!("<{}", tag);
    let close = format!("</{}>", tag);
    let Some(start) = item_xml.find(&open) else {
        return (String::new(), String::new());
    };
    let after_open = &item_xml[start + open.len()..];
    let Some(gt) = after_open.find('>') else {
        return (String::new(), String::new());
    };
    let attrs = &after_open[..gt];
    let source_icon = extract_attr(attrs, "url").unwrap_or_default();
    let content = &after_open[gt + 1..];
    let end = content.find(&close).unwrap_or(content.len());
    let source_name = decode_entities(content[..end].trim());
    (source_name, source_icon)
}

fn extract_attr(attrs: &str, name: &str) -> Option<String> {
    let needle = format!("{}=\"", name);
    let start = attrs.find(&needle)?;
    let after = &attrs[start + needle.len()..];
    let end = after.find('"')?;
    Some(after[..end].to_string())
}

/// Parse RFC-2822 date (the format used in RSS `<pubDate>`).
pub fn parse_pub_date(date_str: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc2822(date_str.trim())
        .ok()
        .map(|dt| dt.with_timezone(&Utc))
}

fn extract_rss_thumbnail(item_xml: &str) -> String {
    // 1. <media:content url="..." />
    if let Some(url) = extract_media_content_url(item_xml) {
        return url;
    }
    // 2. <enclosure url="..." />
    if let Some(url) = extract_enclosure_url(item_xml) {
        return url;
    }
    // 3. <img> inside <description>
    if let Some(desc) = xml_tag_content(item_xml, "description") {
        let decoded = strip_cdata(&decode_entities(desc));
        if let Some(url) = first_img_src(&decoded) {
            return url;
        }
    }
    String::new()
}

fn extract_media_content_url(xml: &str) -> Option<String> {
    let start = xml.find("<media:content")?;
    let rest = &xml[start..];
    let end = rest.find('>')?;
    let tag = &rest[..end];
    extract_attr(tag, "url").filter(|u| u.starts_with("http"))
}

fn extract_enclosure_url(xml: &str) -> Option<String> {
    let start = xml.find("<enclosure")?;
    let rest = &xml[start..];
    let end = rest.find('>')?;
    let tag = &rest[..end];
    extract_attr(tag, "url").filter(|u| u.starts_with("http"))
}

pub fn first_img_src(html: &str) -> Option<String> {
    let start = html.find("<img ")?;
    let rest = &html[start..];
    let end = rest.find('>')?;
    let tag = &rest[..end];
    extract_attr(tag, "src").filter(|u| u.starts_with("http"))
}

pub fn parse_rss_items(xml: &str) -> Vec<RssItem> {
    let mut items = Vec::new();
    let mut search_from = 0usize;

    loop {
        let Some(item_start) = xml[search_from..].find("<item>") else {
            break;
        };
        let abs_start = search_from + item_start;
        let Some(item_end) = xml[abs_start..].find("</item>") else {
            break;
        };
        let item_xml = &xml[abs_start..abs_start + item_end + 7];
        search_from = abs_start + item_end + 7;

        let title = xml_tag_content(item_xml, "title")
            .map(|s| strip_trailing_source(&decode_entities(&strip_cdata(s))))
            .unwrap_or_default();
        let link = xml_tag_content(item_xml, "link")
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        let pub_date_raw = xml_tag_content(item_xml, "pubDate")
            .unwrap_or("")
            .to_string();
        let pub_date_parsed = parse_pub_date(&pub_date_raw);
        let (source_name, source_icon) = parse_source_tag(item_xml);
        let thumbnail = extract_rss_thumbnail(item_xml);

        if title.is_empty() || link.is_empty() {
            continue;
        }

        items.push(RssItem {
            title,
            link,
            pub_date: pub_date_parsed
                .map(|dt| dt.to_rfc3339())
                .unwrap_or_else(|| pub_date_raw.clone()),
            pub_date_parsed,
            source_name,
            source_icon,
            thumbnail,
        });
    }

    items
}

pub fn rss_item_to_article(rss: &RssItem, category: &str, language: &str, article_type: &str) -> Article {
    Article {
        id: generate_article_id(&rss.link, &rss.title),
        title: rss.title.clone(),
        url: rss.link.clone(),
        date: rss.pub_date.clone(),
        source_name: rss.source_name.clone(),
        source_icon: rss.source_icon.clone(),
        authors: Vec::new(),
        language: language.to_string(),
        thumbnail: rss.thumbnail.clone(),
        category: category.to_string(),
        article_type: article_type.to_string(),
        ai_summary: String::new(),
        og_content: String::new(),
        snippet: String::new(),
        status: "pending".to_string(),
    }
}

pub async fn fetch_rss_feed(client: &Client, url: &str) -> Result<String, String> {
    let response = client
        .get(url)
        .header("User-Agent", "Mozilla/5.0 (compatible; NewsPageBot/1.0)")
        .send()
        .await
        .map_err(|e| format!("RSS fetch failed for {}: {}", url, e))?;

    if !response.status().is_success() {
        return Err(format!(
            "RSS fetch returned HTTP {} for {}",
            response.status(),
            url
        ));
    }

    response
        .text()
        .await
        .map_err(|e| format!("RSS body read failed for {}: {}", url, e))
}
