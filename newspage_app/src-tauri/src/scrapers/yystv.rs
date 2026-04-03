use async_trait::async_trait;
use chrono::{DateTime, NaiveDate, NaiveDateTime};
use reqwest::Client;
use scraper::{Html, Selector};
use std::collections::HashSet;
use std::time::Duration;

use crate::id_generator::generate_article_id;
use crate::news_item::NewsItem;

use super::{ScrapeContext, ScraperStage};

const ENABLED: bool = true;
const YYSTV_NEWS_URL: &str = "https://www.yystv.cn/docs";
const DEFAULT_ITEM_LIMIT: usize = 100;
const SOURCE_NAME: &str = "YYSTV";
const SOURCE_ICON: &str = "https://www.yystv.cn/favicon.ico";
const CATEGORY: &str = "gaming";
const LANGUAGE: &str = "zh";
const CN_REGION_ID: &str = "chinese";

pub type YystvNewsItem = NewsItem;

async fn fetch_yystv_html() -> Result<String, String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36")
        .build()
        .map_err(|e| format!("YYSTV client build failed: {}", e))?;
    let response = client
        .get(YYSTV_NEWS_URL)
        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
        .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
        .header("Referer", "https://www.yystv.cn/")
        .send()
        .await
        .map_err(|e| format!("YYSTV fetch failed: {}", e))?;

    let response = response
        .error_for_status()
        .map_err(|e| format!("YYSTV returned non-success status: {}", e))?;

    response
        .text()
        .await
        .map_err(|e| format!("YYSTV body read failed: {}", e))
}

fn clean_text(input: &str) -> String {
    input.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn strip_tags(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut in_tag = false;
    for ch in input.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    clean_text(&out)
}

fn decode_html_entities(input: &str) -> String {
    input
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&nbsp;", " ")
}

fn extract_attr(fragment: &str, attr: &str) -> Option<String> {
    let marker = format!("{}=\"", attr);
    let start = fragment.find(&marker)?;
    let rest = &fragment[start + marker.len()..];
    let end = rest.find('"')?;
    Some(rest[..end].trim().to_string())
}

fn extract_after_marker(fragment: &str, marker: &str, end_marker: &str) -> Option<String> {
    let start = fragment.find(marker)?;
    let rest = &fragment[start + marker.len()..];
    let end = rest.find(end_marker)?;
    Some(rest[..end].to_string())
}

fn parse_yystv_items_fallback(html: &str) -> Vec<YystvNewsItem> {
    let mut items = Vec::new();
    let mut seen = HashSet::new();
    let mut remaining = html;

    while let Some(start) = remaining.find("articles-item") {
        let chunk_start = start.saturating_sub(64);
        let rest = &remaining[chunk_start..];
        let end = match rest.find("</li>") {
            Some(pos) => pos + 5,
            None => break,
        };
        let chunk = &rest[..end];
        remaining = &rest[end..];

        let url = extract_attr(chunk, "href")
            .map(|value| normalize_url(&value))
            .unwrap_or_default();
        if url.is_empty() {
            continue;
        }

        let title = extract_after_marker(chunk, "articles-title\">", "</h2>")
            .map(|value| clean_text(&decode_html_entities(&strip_tags(&value))))
            .unwrap_or_default();
        if title.is_empty() {
            continue;
        }

        let snippet = extract_after_marker(chunk, "article-brief", "</p>")
            .and_then(|value| value.split_once('>').map(|(_, inner)| inner.to_string()))
            .map(|value| clean_text(&decode_html_entities(&strip_tags(&value))))
            .unwrap_or_default();

        let thumbnail = extract_attr(chunk, "data-src")
            .or_else(|| extract_attr(chunk, "src"))
            .map(|value| normalize_url(&value))
            .unwrap_or_default();

        let date = if let Some(meta_idx) = chunk.rfind("article-meta-item") {
            let meta = &chunk[meta_idx..];
            extract_after_marker(meta, ">", "</span>")
                .map(|value| normalize_date_string(&decode_html_entities(&strip_tags(&value))))
                .unwrap_or_default()
        } else {
            String::new()
        };

        let id = generate_article_id(&url, &title);
        if !seen.insert(id.clone()) {
            continue;
        }

        items.push(YystvNewsItem {
            id,
            title,
            url,
            date,
            source_name: SOURCE_NAME.to_string(),
            source_icon: SOURCE_ICON.to_string(),
            authors: Vec::new(),
            language: LANGUAGE.to_string(),
            thumbnail,
            category: CATEGORY.to_string(),
            ai_summary: String::new(),
            og_content: String::new(),
            snippet,
            is_enriched: false,
        });
    }

    items
}

fn normalize_url(url: &str) -> String {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return trimmed.to_string();
    }

    if let Some(path) = trimmed.strip_prefix('/') {
        return format!("https://www.yystv.cn/{}", path);
    }

    format!("https://www.yystv.cn/{}", trimmed)
}

fn normalize_date_string(raw: &str) -> String {
    let text = clean_text(raw);
    if text.is_empty() {
        return String::new();
    }

    if let Ok(dt) = DateTime::parse_from_rfc3339(&text) {
        return dt.to_rfc3339();
    }
    if let Ok(dt) = DateTime::parse_from_rfc2822(&text) {
        return dt.to_rfc3339();
    }

    let normalized = text
        .replace('年', "-")
        .replace('月', "-")
        .replace('日', "")
        .replace('T', " ");

    for fmt in ["%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y/%m/%d %H:%M:%S", "%Y/%m/%d %H:%M"] {
        if let Ok(ndt) = NaiveDateTime::parse_from_str(&normalized, fmt) {
            return ndt.and_utc().to_rfc3339();
        }
    }

    for fmt in ["%Y-%m-%d", "%Y/%m/%d"] {
        if let Ok(date) = NaiveDate::parse_from_str(&normalized, fmt) {
            if let Some(ndt) = date.and_hms_opt(0, 0, 0) {
                return ndt.and_utc().to_rfc3339();
            }
        }
    }

    text
}

fn parse_yystv_items(html: &str) -> Vec<YystvNewsItem> {
    let document = Html::parse_document(html);

    let list_root_selector = Selector::parse(".articles-list, .articles-list-container ul").unwrap();
    let article_selector = Selector::parse("li.articles-item, .articles-item, article, li").unwrap();
    let title_selector = Selector::parse(".articles-title, h1, h2, h3, .title").unwrap();
    let title_link_selector = Selector::parse("a.articles-link, h1 a, h2 a, h3 a, .title a, a[href]").unwrap();
    let date_selector = Selector::parse("time, .date, .article-meta-item, .meta .time, .meta").unwrap();
    let snippet_selector = Selector::parse(".article-brief, p, .summary, .desc, .excerpt").unwrap();
    let image_selector = Selector::parse("img").unwrap();

    let mut seen = HashSet::new();
    let mut items = Vec::new();

    let roots: Vec<_> = {
        let selected: Vec<_> = document.select(&list_root_selector).collect();
        if selected.is_empty() {
            vec![document.root_element()]
        } else {
            selected
        }
    };

    for root in roots {
        for node in root.select(&article_selector) {
            let Some(link_node) = node.select(&title_link_selector).next() else {
                continue;
            };

            let title = node
                .select(&title_selector)
                .next()
                .map(|n| clean_text(&n.text().collect::<String>()))
                .filter(|t| !t.is_empty())
                .unwrap_or_else(|| clean_text(&link_node.text().collect::<String>()));
            if title.is_empty() {
                continue;
            }

            let raw_url = link_node.value().attr("href").unwrap_or("");
            let url = normalize_url(raw_url);
            if url.is_empty() {
                continue;
            }

            let mut date_candidates: Vec<String> = Vec::new();
            for n in node.select(&date_selector) {
                if let Some(datetime) = n.value().attr("datetime") {
                    let val = clean_text(datetime);
                    if !val.is_empty() {
                        date_candidates.push(val);
                    }
                }
                let text = clean_text(&n.text().collect::<String>());
                if !text.is_empty() {
                    date_candidates.push(text);
                }
            }

            let date_raw = date_candidates
                .iter()
                .rev()
                .find(|value| value.chars().any(|c| c.is_ascii_digit()) || value.contains('前'))
                .cloned()
                .unwrap_or_default();
            let date = normalize_date_string(&date_raw);

            let snippet = node
                .select(&snippet_selector)
                .next()
                .map(|n| clean_text(&n.text().collect::<String>()))
                .filter(|s| !s.is_empty())
                .unwrap_or_default();

            let thumbnail = node
                .select(&image_selector)
                .next()
                .and_then(|img| {
                    img.value()
                        .attr("src")
                        .or_else(|| img.value().attr("data-src"))
                        .or_else(|| img.value().attr("data-original"))
                })
                .map(normalize_url)
                .unwrap_or_default();

            let id = generate_article_id(&url, &title);
            if !seen.insert(id.clone()) {
                continue;
            }

            items.push(YystvNewsItem {
                id,
                title,
                url,
                date,
                source_name: SOURCE_NAME.to_string(),
                source_icon: SOURCE_ICON.to_string(),
                authors: Vec::new(),
                language: LANGUAGE.to_string(),
                thumbnail,
                category: CATEGORY.to_string(),
                ai_summary: String::new(),
                og_content: String::new(),
                snippet,
                is_enriched: false,
            });
        }
    }

    if items.is_empty() {
        parse_yystv_items_fallback(html)
    } else {
        items
    }
}

fn yystv_sort_key(item: &YystvNewsItem) -> (Option<i64>, String) {
    let ts = DateTime::parse_from_rfc3339(&item.date)
        .ok()
        .map(|dt| dt.timestamp())
        .or_else(|| {
            let normalized = item
                .date
                .replace('年', "-")
                .replace('月', "-")
                .replace('日', "");
            NaiveDateTime::parse_from_str(&normalized, "%Y-%m-%d %H:%M:%S")
                .ok()
                .map(|ndt| ndt.and_utc().timestamp())
        });

    (ts, item.date.clone())
}

fn sort_by_date_desc(items: &mut [YystvNewsItem]) {
    items.sort_by(|a, b| yystv_sort_key(b).cmp(&yystv_sort_key(a)));
}

fn should_run_for_cn_region(ctx: &ScrapeContext) -> bool {
    ctx.selected_regions
        .iter()
        .any(|region| region.eq_ignore_ascii_case(CN_REGION_ID))
}

pub async fn scrape_yystv(limit: Option<usize>) -> Result<Vec<YystvNewsItem>, String> {
    let html = fetch_yystv_html().await?;
    let mut items = parse_yystv_items(&html);

    if items.is_empty() {
        eprintln!(
            "[YYSTV] HTML length={} has_articles_list={} has_articles_title={}",
            html.len(),
            html.contains("articles-list"),
            html.contains("articles-title")
        );
        return Err("YYSTV docs page returned 0 parseable items".to_string());
    }

    sort_by_date_desc(&mut items);
    let limit = limit.unwrap_or(DEFAULT_ITEM_LIMIT);
    items.truncate(limit);

    Ok(items)
}

pub struct YystvScraperStage;

#[async_trait]
impl ScraperStage for YystvScraperStage {
    fn name(&self) -> &'static str {
        "YYSTV"
    }

    fn should_run(&self, ctx: &ScrapeContext) -> bool {
        ENABLED && should_run_for_cn_region(ctx)
    }

    async fn run(&self, _ctx: &ScrapeContext) -> Result<Vec<NewsItem>, String> {
        // Do not fail the whole pipeline when YYSTV is temporarily unreachable.
        match scrape_yystv(None).await {
            Ok(items) => Ok(items),
            Err(e) => {
                eprintln!("[YYSTV] scrape failed: {}. Returning empty.", e);
                Ok(Vec::new())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const HTML_FIXTURE: &str = r#"<!doctype html>
<html>
  <body>
    <section class="articles-list">
            <li class="articles-item">
                <a href="/p/12345" class="articles-link hover-scale">
                    <img data-src="/images/a.jpg" />
                    <h2 class="articles-title"> 第一条 游戏新闻 </h2>
                    <p class="article-brief">这是一段摘要。</p>
                    <span class="article-meta-item">22小时前</span>
                </a>
            </li>
            <li class="articles-item">
                <a href="https://www.yystv.cn/p/12346" class="articles-link hover-scale">
                    <h2 class="articles-title">第二条游戏新闻</h2>
                    <p class="article-brief">另一个摘要。</p>
                    <span class="article-meta-item">2026年03月31日 10:00</span>
                </a>
            </li>
            <li class="articles-item">
                <a href="/p/12345" class="articles-link hover-scale">
                    <h2 class="articles-title"> 第一条 游戏新闻 </h2>
                </a>
            </li>
    </section>
  </body>
</html>"#;

    #[test]
    fn parser_extracts_and_dedups_items() {
        let items = parse_yystv_items(HTML_FIXTURE);
        assert_eq!(items.len(), 2);
    }

    #[test]
    fn parser_maps_required_fields() {
        let items = parse_yystv_items(HTML_FIXTURE);
        let first = &items[0];

        assert_eq!(first.source_name, "YYSTV");
        assert_eq!(first.category, "gaming");
        assert_eq!(first.language, "zh");
        assert!(!first.id.is_empty());
        assert!(first.url.starts_with("https://www.yystv.cn/"));
    }

    #[test]
    fn date_normalization_handles_cn_format() {
        let got = normalize_date_string("2026年04月01日 13:45");
        assert!(DateTime::parse_from_rfc3339(&got).is_ok());
    }

    #[test]
    fn stage_runs_only_for_chinese_region() {
        let cn = ScrapeContext {
            selected_regions: vec!["chinese".to_string()],
        };
        let non_cn = ScrapeContext {
            selected_regions: vec!["canada".to_string()],
        };

        assert!(should_run_for_cn_region(&cn));
        assert!(!should_run_for_cn_region(&non_cn));
    }

    #[test]
    fn fallback_parser_extracts_live_like_markup() {
        let items = parse_yystv_items_fallback(HTML_FIXTURE);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].title, "第一条 游戏新闻");
        assert!(items[0].url.ends_with("/p/12345"));
    }
}
