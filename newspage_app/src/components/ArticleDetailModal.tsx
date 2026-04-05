import { useEffect, useState, type ReactElement } from "react";
import { ArrowLeft } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { ARTICLE_HERO_FALLBACK_URL } from "../constants/news";
import { useImageFallback } from "../hooks/useImageFallback";
import { useLiveTranslation, type TranslationRuntimeConfig } from "../hooks/useLiveTranslation";
import type { NewsArticle } from "../types/news";
import { getTagColor } from "../utils/newsMeta";
import { usePanelTransition } from "../hooks/usePanelTransition";

interface ArticleDetailModalProps {
  selectedArticle: NewsArticle | null;
  isDarkMode: boolean;
  reprocessingArticleId: string | null;
  liveTranslationEnabled: boolean;
  translationTargetLanguage: "en" | "zh-CN";
  translationRuntime: TranslationRuntimeConfig;
  onClose: () => void;
  onOpenUrl: (url: string) => void;
  onReprocessArticle: (article: NewsArticle) => void;
}

export function ArticleDetailModal({
  selectedArticle,
  isDarkMode,
  reprocessingArticleId,
  liveTranslationEnabled,
  translationTargetLanguage,
  translationRuntime,
  onClose,
  onOpenUrl,
  onReprocessArticle,
}: ArticleDetailModalProps): ReactElement | null {
  const [articleSnapshot, setArticleSnapshot] = useState<NewsArticle | null>(null);
  const { isMounted, isClosing } = usePanelTransition(!!selectedArticle, 170);
  const activeArticle = selectedArticle ?? articleSnapshot;
  const isTitleOnlyArticle =
    (activeArticle?.snippet.trim().length ?? 0) === 0
    && (activeArticle?.aiSummary.trim().length ?? 0) === 0;
  const onThumbnailError = useImageFallback(ARTICLE_HERO_FALLBACK_URL);

  useEffect(() => {
    if (selectedArticle) {
      setArticleSnapshot(selectedArticle);
      return;
    }

    if (!isMounted) {
      setArticleSnapshot(null);
    }
  }, [selectedArticle, isMounted]);

  const translatedTitle = useLiveTranslation({
    text: activeArticle?.title ?? "",
    sourceLanguage: activeArticle?.language ?? "en",
    targetLanguage: translationTargetLanguage,
    enabled: liveTranslationEnabled,
    runtime: translationRuntime,
  });
  const translatedSummary = useLiveTranslation({
    text: activeArticle?.aiSummary ?? "",
    sourceLanguage: activeArticle?.language ?? "en",
    targetLanguage: translationTargetLanguage,
    enabled: liveTranslationEnabled && !isTitleOnlyArticle,
    runtime: translationRuntime,
  });

  if (!isMounted || !activeArticle) {
    return null;
  }

  return (
    <div className={`${isClosing ? "popup-overlay-out" : "popup-overlay"} fixed inset-0 z-50 overflow-y-auto news-scroll ${isDarkMode ? "news-scroll-dark bg-zinc-950 text-zinc-300" : "news-scroll-light bg-zinc-150 text-zinc-800"}`}>
      <div
        className={`${isClosing ? "popup-panel-out" : "popup-panel"} sticky top-0 z-10 flex items-center border-b px-4 py-4 md:px-8 ${
          isDarkMode ? "border-zinc-800 bg-zinc-950/95" : "border-zinc-200 bg-zinc-150/95"
        } backdrop-blur-md`}
      >
        <button
          onClick={onClose}
          className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-black uppercase tracking-widest transition-colors ${
            isDarkMode ? "border-zinc-700 text-zinc-200 hover:bg-zinc-800" : "border-zinc-300 text-zinc-800 hover:bg-zinc-200"
          }`}
        >
          <ArrowLeft size={14} />
          Return
        </button>
      </div>

      <article className="pb-16">
        <div className="h-64 w-full md:h-[30rem]">
          <img
            src={activeArticle.thumbnailUrl}
            alt={`${activeArticle.title} thumbnail`}
            className="h-full w-full object-cover"
            onError={onThumbnailError}
          />
        </div>

        <div className="mx-auto w-full max-w-5xl space-y-8 px-4 pt-8 md:px-8">
          <div>
            <span
              className={`mb-4 inline-block rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest text-white shadow-sm ${getTagColor(
                activeArticle.category,
              )}`}
            >
              {activeArticle.category}
            </span>
            <h2 className={`text-3xl font-black leading-tight md:text-5xl ${isDarkMode ? "text-zinc-100" : "text-zinc-900"}`}>
              {translatedTitle}
            </h2>
            <div className={`mt-4 flex items-center gap-3 text-xs font-black uppercase tracking-widest ${
              isDarkMode ? "text-zinc-500" : "text-zinc-600"
            }`}>
              {activeArticle.sourceIconUrl ? (
                <img
                  src={activeArticle.sourceIconUrl}
                  alt={`${activeArticle.sourceName} icon`}
                  className="h-5 w-5 rounded-sm object-contain"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              ) : null}
              <span>{activeArticle.sourceName}</span>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="rounded-full bg-zinc-500/20 px-3 py-1 text-[10px] font-bold uppercase tracking-widest opacity-70">{activeArticle.date}</span>
            </div>
          </div>

          {!isTitleOnlyArticle && (
            <div className={`rounded-2xl border-l-4 p-6 ${isDarkMode ? "border-zinc-400 bg-zinc-900" : "border-zinc-800 bg-zinc-150"}`}>
              <ReactMarkdown
                components={{
                  ul: ({ children }) => (
                    <ul className={`space-y-2 text-lg leading-relaxed ${isDarkMode ? "text-zinc-100" : "text-zinc-900"}`}>{children}</ul>
                  ),
                  li: ({ children }) => (
                    <li className="flex gap-2">
                      <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${isDarkMode ? "bg-zinc-400" : "bg-zinc-600"}`} />
                      <span>{children}</span>
                    </li>
                  ),
                  p: ({ children }) => (
                    <p className={`text-lg leading-relaxed ${isDarkMode ? "text-zinc-100" : "text-zinc-900"}`}>{children}</p>
                  ),
                }}
              >
                {translatedSummary}
              </ReactMarkdown>
            </div>
          )}

          <div className={`flex flex-col items-start gap-4 text-lg leading-relaxed ${isDarkMode ? "text-zinc-400" : "text-zinc-700"}`}>
            {activeArticle.url && (
              <button
                onClick={() => onOpenUrl(activeArticle.url)}
                className={`inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold transition-colors ${
                  isDarkMode
                    ? "bg-zinc-700 text-zinc-100 hover:bg-zinc-600"
                    : "bg-zinc-200 text-zinc-900 hover:bg-zinc-300"
                }`}
              >
                Go to original page
              </button>
            )}
            <button
              type="button"
              disabled={reprocessingArticleId === activeArticle.id}
              onClick={() => onReprocessArticle(activeArticle)}
              className={`inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold transition-colors ${
                isDarkMode
                  ? "bg-zinc-800 text-zinc-100 hover:bg-zinc-700"
                  : "bg-zinc-200 text-zinc-900 hover:bg-zinc-300"
              } disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {reprocessingArticleId === activeArticle.id ? "Re-processing..." : "Re-process this news"}
            </button>
          </div>
        </div>
      </article>
    </div>
  );
}
