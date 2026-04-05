const HTTP_PROTOCOL_PATTERN = /^https?:\/\//i;

function ensureHttpProtocol(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (HTTP_PROTOCOL_PATTERN.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed.replace(/^\/+/, "")}`;
}

export function normalizeRssFeedUrl(value: string): string {
  return ensureHttpProtocol(value);
}
