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

interface PendingEntry {
  resolve: (value: string) => void;
  reject: (reason: unknown) => void;
}

let batchQueue: Array<{
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
  provider: string;
  model: string;
  apiKey: string | null;
  endpoint: string | null;
  cacheKey: string;
  pending: PendingEntry;
}> = [];

let batchTimer: ReturnType<typeof setTimeout> | null = null;

function flushBatch() {
  const currentBatch = batchQueue;
  batchQueue = [];
  batchTimer = null;

  if (currentBatch.length === 0) return;

  if (currentBatch.length === 1) {
    const item = currentBatch[0];
    void invoke<string>("translate_text", {
      text: item.text,
      sourceLanguage: item.sourceLanguage,
      targetLanguage: item.targetLanguage,
      provider: item.provider,
      model: item.model,
      apiKey: item.apiKey,
      endpoint: item.endpoint,
    })
      .then((result) => {
        const nextValue = result?.trim() ? result : item.text;
        evictCache();
        translationCache.set(item.cacheKey, nextValue);
        item.pending.resolve(nextValue);
      })
      .catch((err) => {
        item.pending.reject(err);
      });
    return;
  }

  const first = currentBatch[0];
  void invoke<string[]>("translate_text_batch", {
    texts: currentBatch.map((item) => item.text),
    sourceLanguage: first.sourceLanguage,
    targetLanguage: first.targetLanguage,
    provider: first.provider,
    model: first.model,
    apiKey: first.apiKey,
    endpoint: first.endpoint,
  })
    .then((results) => {
      const batch = currentBatch;
      for (let i = 0; i < batch.length; i++) {
        const item = batch[i];
        const result = results?.[i];
        const nextValue = result?.trim() ? result : item.text;
        evictCache();
        translationCache.set(item.cacheKey, nextValue);
        item.pending.resolve(nextValue);
      }
    })
    .catch((err) => {
      for (const item of currentBatch) {
        item.pending.reject(err);
      }
    });
}

function evictCache() {
  if (translationCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = translationCache.keys().next().value;
    if (oldestKey !== undefined) translationCache.delete(oldestKey);
  }
}

function enqueueTranslation(params: {
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
  provider: string;
  model: string;
  apiKey: string | null;
  endpoint: string | null;
  cacheKey: string;
}): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    batchQueue.push({ ...params, pending: { resolve, reject } });

    if (!batchTimer) {
      batchTimer = setTimeout(flushBatch, 16);
    }
  });
}

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
      return () => { cancelled = true; };
    }

    if (isSameLanguage(normalizedSourceLanguage, targetLanguage)) {
      setTranslatedText(text);
      return () => { cancelled = true; };
    }

    const cached = translationCache.get(cacheKey);
    if (cached) {
      setTranslatedText(cached);
      return () => { cancelled = true; };
    }

    void enqueueTranslation({
      text,
      sourceLanguage: normalizedSourceLanguage,
      targetLanguage,
      provider: runtime.provider,
      model: runtime.model,
      apiKey: runtime.apiKey.trim() || null,
      endpoint: runtime.endpoint.trim() || null,
      cacheKey,
    })
      .then((result) => {
        if (!cancelled) {
          setTranslatedText(result);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTranslatedText(text);
        }
      });

    return () => { cancelled = true; };
  }, [cacheKey, enabled, normalizedSourceLanguage, normalizedText, targetLanguage, text, runtime.apiKey, runtime.endpoint, runtime.model, runtime.provider]);

  return translatedText;
}
