use std::collections::HashMap;

#[derive(Debug, Clone, Default)]
pub struct ProxySettings {
    pub proxy_type: String,
    pub address: String,
    pub username: String,
    pub password: String,
}

impl ProxySettings {
    pub fn is_enabled(&self) -> bool {
        self.proxy_type != "none" && !self.address.trim().is_empty()
    }

    pub fn from_settings_map(map: &HashMap<String, String>) -> Self {
        let proxy_type = map.get("proxyType").cloned().unwrap_or_default();
        let proxy_type = match proxy_type.as_str() {
            "http" | "socks5" => proxy_type,
            _ => "none".to_string(),
        };
        Self {
            proxy_type,
            address: map.get("proxyAddress").cloned().unwrap_or_default(),
            username: map.get("proxyUsername").cloned().unwrap_or_default(),
            password: map.get("proxyPassword").cloned().unwrap_or_default(),
        }
    }
}

pub fn build_proxied_client(proxy: &ProxySettings) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder();

    if proxy.is_enabled() {
        let scheme = match proxy.proxy_type.as_str() {
            "http" => "http",
            "socks5" => "socks5",
            _ => return Err(format!("Unsupported proxy type: {}", proxy.proxy_type)),
        };

        let address = proxy.address.trim();
        if address.is_empty() {
            return Err("Proxy address is empty".to_string());
        }

        if !address.contains(':') {
            return Err(format!(
                "Invalid proxy address '{}': expected host:port",
                address
            ));
        }

        let proxy_url = format!("{}://{}", scheme, address);
        let mut req_proxy = reqwest::Proxy::all(&proxy_url)
            .map_err(|e| format!("Invalid proxy configuration '{}': {}", proxy_url, e))?;

        if !proxy.username.is_empty() {
            req_proxy = req_proxy.basic_auth(&proxy.username, &proxy.password);
        }

        builder = builder.proxy(req_proxy);
    }

    builder
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))
}

pub fn is_loopback_host(host: &str) -> bool {
    let lower = host.to_ascii_lowercase();
    lower == "localhost"
        || lower == "127.0.0.1"
        || lower == "::1"
        || lower == "0.0.0.0"
        || lower == "[::1]"
}

pub fn should_skip_proxy_for_url(proxy: &ProxySettings, url: &str) -> bool {
    if !proxy.is_enabled() {
        return true;
    }
    let host = reqwest::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.to_string()));
    match host {
        Some(h) => is_loopback_host(&h),
        None => false,
    }
}
