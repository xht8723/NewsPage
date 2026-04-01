export function normalizeSourceName(value: string): string {
  return value.trim().toLowerCase();
}

export function parseSourceBlacklist(rawValue: string | undefined): string[] {
  if (!rawValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    const deduped = new Map<string, string>();
    for (const item of parsed) {
      if (typeof item !== "string") {
        continue;
      }
      const trimmed = item.trim();
      const normalized = normalizeSourceName(trimmed);
      if (!normalized || deduped.has(normalized)) {
        continue;
      }
      deduped.set(normalized, trimmed);
    }

    return Array.from(deduped.values());
  } catch {
    return [];
  }
}

export function toNormalizedSourceSet(items: string[]): Set<string> {
  const values = items
    .map((item) => normalizeSourceName(item))
    .filter(Boolean);
  return new Set(values);
}

export function addSourceToBlacklist(existing: string[], sourceName: string): string[] {
  const trimmedSource = sourceName.trim();
  const normalizedSource = normalizeSourceName(trimmedSource);
  if (!normalizedSource) {
    return existing;
  }

  const deduped = new Map<string, string>();
  for (const item of existing) {
    const trimmed = item.trim();
    const normalized = normalizeSourceName(trimmed);
    if (!normalized || deduped.has(normalized)) {
      continue;
    }
    deduped.set(normalized, trimmed);
  }

  if (!deduped.has(normalizedSource)) {
    deduped.set(normalizedSource, trimmedSource);
  }

  return Array.from(deduped.values()).sort((left, right) => left.localeCompare(right));
}

export function removeSourceFromBlacklist(existing: string[], sourceName: string): string[] {
  const normalized = normalizeSourceName(sourceName);
  if (!normalized) {
    return existing;
  }

  return existing
    .filter((item) => normalizeSourceName(item) !== normalized)
    .sort((left, right) => left.localeCompare(right));
}
