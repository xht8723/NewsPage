import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface TranslationRuntimeConfig {
  provider: string;
  model: string;
  apiKey: string;
  endpoint: string;
}

interface UseLiveTranslationParams {
  text: string;
  sourceLanguage?: string;
  targetLanguage: "en" | "zh-CN";
  enabled: boolean;
  runtime: TranslationRuntimeConfig;
}

const MAX_CACHE_SIZE = 500;
const translationCache = new Map<string, string>();

function normalizeLang(value?: string): string {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : "unknown";
}

function isSameLanguage(sourceLanguage: string, targetLanguage: "en" | "zh-CN"): boolean {
  const normalized = sourceLanguage.toLowerCase();
  if (targetLanguage === "en") {
    return normalized.startsWith("en");
  }
  return normalized.startsWith("zh");
}

export function useLiveTranslation({
  text,
  sourceLanguage,
  targetLanguage,
  enabled,
  runtime,
}: UseLiveTranslationParams): string {
  const [translatedText, setTranslatedText] = useState(text);

  const normalizedText = text.trim();
  const normalizedSourceLanguage = normalizeLang(sourceLanguage);
  const cacheKey = useMemo(() => {
    return [
      runtime.provider,
      runtime.model,
      runtime.endpoint,
      targetLanguage,
      normalizedSourceLanguage,
      text,
    ].join("::");
  }, [runtime.provider, runtime.model, runtime.endpoint, targetLanguage, normalizedSourceLanguage, text]);

  useEffect(() => {
    let cancelled = false;

    if (!enabled || !normalizedText) {
      setTranslatedText(text);
      return () => {
        cancelled = true;
      };
    }

    if (isSameLanguage(normalizedSourceLanguage, targetLanguage)) {
      setTranslatedText(text);
      return () => {
        cancelled = true;
      };
    }

    const cached = translationCache.get(cacheKey);
    if (cached) {
      setTranslatedText(cached);
      return () => {
        cancelled = true;
      };
    }

    void invoke<string>("translate_text", {
      text,
      sourceLanguage: normalizedSourceLanguage,
      targetLanguage,
      provider: runtime.provider,
      model: runtime.model,
      apiKey: runtime.apiKey.trim() || null,
      endpoint: runtime.endpoint.trim() || null,
    })
      .then((result) => {
        if (cancelled) {
          return;
        }
        const nextValue = result?.trim() ? result : text;
        if (translationCache.size >= MAX_CACHE_SIZE) {
          const oldestKey = translationCache.keys().next().value;
          if (oldestKey !== undefined) translationCache.delete(oldestKey);
        }
        translationCache.set(cacheKey, nextValue);
        setTranslatedText(nextValue);
      })
      .catch(() => {
        if (!cancelled) {
          setTranslatedText(text);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, enabled, normalizedSourceLanguage, normalizedText, targetLanguage, text, runtime.apiKey, runtime.endpoint, runtime.model, runtime.provider]);

  return translatedText;
}
