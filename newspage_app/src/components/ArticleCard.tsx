import { Clock } from "lucide-react";
import { ChevronRight } from "lucide-react";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import { ARTICLE_THUMBNAIL_FALLBACK_URL, type LayoutMode } from "../constants/article";
import { useImageFallback } from "../hooks/useImageFallback";
import { useLiveTranslation, type TranslationRuntimeConfig } from "../hooks/useLiveTranslation";
import type { NewsArticle } from "../types/article";
import { type TagColorResult, resolveTagColorFromMap } from "../utils/articleMeta";

type TagColorMap = Map<string, TagColorResult>;

function formatRelativeTime(timestamp: number, language: string): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  if (diffMs < 0) return i18n.t("article.justNow");
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return i18n.t("article.justNow");
  if (minutes < 60) return i18n.t("article.minutesAgo", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return i18n.t("article.hoursAgo", { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return i18n.t("article.daysAgo", { count: days });
  const date = new Date(timestamp);
  return date.toLocaleDateString(language === "zh-CN" ? "zh-CN" : "en-US", { month: "short", day: "numeric" });
}

function formatExactDateTime(timestamp: number, language: string): string {
  const date = new Date(timestamp);
  return date.toLocaleString(language === "zh-CN" ? "zh-CN" : "en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: language !== "zh-CN",
  });
}

interface ArticleCardProps {
  item: NewsArticle;
  tagColorMap: TagColorMap;
  layout: LayoutMode;
  isDarkMode: boolean;
  sortMode: string;
  liveTranslationEnabled: boolean;
  translationTargetLanguage: "en" | "zh-CN";
  translationRuntime: TranslationRuntimeConfig;
  isNew?: boolean;
  dataArticleId?: string;
  onSelect: (article: NewsArticle) => void;
  onOpenContextMenu: (article: NewsArticle, x: number, y: number) => void;
}

function ArticleCardComponent({
  item,
  tagColorMap,
  layout,
  isDarkMode,
  sortMode,
  liveTranslationEnabled,
  translationTargetLanguage,
  translationRuntime,
  isNew,
  dataArticleId,
  onSelect,
  onOpenContextMenu,
}: ArticleCardProps): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const isListLayout = layout === "list";
  const isCompactListLayout = layout === "compact_list";
  const isTitleOnlyCard = item.status !== "enriched";
  const onThumbnailError = useImageFallback(ARTICLE_THUMBNAIL_FALLBACK_URL);
  const translatedTitle = useLiveTranslation({
    text: item.title,
    sourceLanguage: item.language,
    targetLanguage: translationTargetLanguage,
    enabled: liveTranslationEnabled,
    runtime: translationRuntime,
  });
  const translatedSnippet = useLiveTranslation({
    text: item.snippet,
    sourceLanguage: item.language,
    targetLanguage: translationTargetLanguage,
    enabled: liveTranslationEnabled && !isTitleOnlyCard,
    runtime: translationRuntime,
  });

  const tagColor = resolveTagColorFromMap(item.category, tagColorMap);

  return (
    <div
      data-article-id={dataArticleId}
      data-card-context-menu="true"
      onClick={() => onSelect(item)}
      onContextMenu={(event) => {
        event.preventDefault();
        onOpenContextMenu(item, event.clientX, event.clientY);
      }}
      className={`group cursor-pointer rounded-2xl border transition-[border-color,box-shadow] hover:shadow-lg ${
        isDarkMode ? "border-zinc-800 bg-zinc-900 hover:border-zinc-600" : "border-zinc-200 bg-white hover:border-zinc-300"
      } ${isListLayout ? "flex flex-col gap-4 p-4 md:flex-row" : isCompactListLayout ? "flex flex-col gap-2 px-3 py-2.5" : "flex flex-col"}${isNew ? " article-new-marker" : ""}`}
    >
      {!isCompactListLayout && (
        <div
          className={`${
            isListLayout ? "h-44 w-full md:h-auto md:w-56 md:flex-shrink-0" : "h-44 w-full"
          } overflow-hidden rounded-xl`}
        >
          <img
            src={item.thumbnailUrl}
            alt={`${item.title} thumbnail`}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            onError={onThumbnailError}
          />
        </div>
      )}
      <div className={`${isCompactListLayout ? "px-1 py-1" : `p-6 ${isListLayout ? "md:py-2" : ""}`} flex flex-1 flex-col`}>
        <div className={`${isCompactListLayout ? "mb-2" : "mb-4"} flex items-center gap-2`}>
          <span
            className={`rounded px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-white shadow-sm${tagColor.type === "class" ? ` ${tagColor.value}` : ""}`}
            style={tagColor.type === "hex" ? { backgroundColor: tagColor.value } : undefined}
          >
            {t(`categories.${item.category.toLowerCase()}`, item.category)}
          </span>
          {sortMode === "score" && item.preferenceScore !== 0 && (
            <span
              title={t("article.relevanceScore", { score: item.preferenceScore.toFixed(3) })}
              className={`ml-auto rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${
                item.preferenceScore > 0
                  ? isDarkMode ? "bg-emerald-500/20 text-emerald-400" : "bg-emerald-100 text-emerald-700"
                  : isDarkMode ? "bg-zinc-500/20 text-zinc-400" : "bg-zinc-100 text-zinc-700"
              }`}
            >
              {item.preferenceScore > 0 ? "+" : ""}
              {(item.preferenceScore * 100).toFixed(0)}%
            </span>
          )}
          {sortMode === "score" && item.preferenceScore === 0 && (
            <span
              title={t("article.noEmbedding")}
              className={`ml-auto rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${
                isDarkMode ? "bg-zinc-700/40 text-zinc-500" : "bg-zinc-100 text-zinc-400"
              }`}
            >
              --
            </span>
          )}
        </div>
        <h3
          className={`${isCompactListLayout ? "mb-2 text-base" : "mb-3 text-lg"} font-bold leading-tight transition-colors ${
            isDarkMode ? "text-zinc-100 group-hover:text-white" : "text-zinc-900"
          }`}
        >
          {translatedTitle}
        </h3>
        {!isTitleOnlyCard && (
          <p
            className={`${isCompactListLayout ? "mb-3" : "mb-5"} text-sm leading-relaxed ${isDarkMode ? "text-zinc-400" : "text-zinc-600"}`}
            style={isCompactListLayout
              ? {
                display: "-webkit-box",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: 2,
                overflow: "hidden",
              }
              : undefined}
          >
            {translatedSnippet}
          </p>
        )}
        <div className="mt-auto flex items-center justify-between gap-3">
          <div className={`flex min-w-0 flex-col gap-0.5 ${isCompactListLayout ? "text-[9px]" : "text-[10px]"} font-black uppercase tracking-widest ${
            isDarkMode ? "text-zinc-500" : "text-zinc-600"
          }`}>
            <span className="truncate">{item.sourceName}</span>
            <span title={formatExactDateTime(item.timestamp, language)} className={`flex items-center gap-1 ${isCompactListLayout ? "text-[8px]" : "text-[9px]"} font-medium normal-case tracking-normal ${isDarkMode ? "text-zinc-600" : "text-zinc-400"}`}>
              <Clock size={10} />
              {formatRelativeTime(item.timestamp, language)}
              <span className="mx-0.5 opacity-40">&middot;</span>
              {formatExactDateTime(item.timestamp, language)}
            </span>
          </div>
          <div
            className={`flex items-center ${isCompactListLayout ? "text-[9px]" : "text-[10px]"} font-black uppercase tracking-widest opacity-60 transition-opacity group-hover:opacity-100 ${
              isDarkMode ? "text-zinc-400" : "text-zinc-900"
            }`}
          >
            {t("article.openBrief")} <ChevronRight size={12} className="ml-1" />
          </div>
        </div>
      </div>
    </div>
  );
}

// Custom comparison function for React.memo to ensure proper prop comparison
function areEqual(prevProps: ArticleCardProps, nextProps: ArticleCardProps): boolean {
  return (
    prevProps.item.id === nextProps.item.id &&
    prevProps.item.title === nextProps.item.title &&
    prevProps.item.snippet === nextProps.item.snippet &&
    prevProps.item.thumbnailUrl === nextProps.item.thumbnailUrl &&
    prevProps.item.category === nextProps.item.category &&
    prevProps.item.status === nextProps.item.status &&
    prevProps.item.preferenceScore === nextProps.item.preferenceScore &&
    prevProps.item.sourceName === nextProps.item.sourceName &&
    prevProps.item.language === nextProps.item.language &&
    prevProps.tagColorMap === nextProps.tagColorMap &&
    prevProps.layout === nextProps.layout &&
    prevProps.isDarkMode === nextProps.isDarkMode &&
    prevProps.sortMode === nextProps.sortMode &&
    prevProps.liveTranslationEnabled === nextProps.liveTranslationEnabled &&
    prevProps.translationTargetLanguage === nextProps.translationTargetLanguage &&
    prevProps.translationRuntime.provider === nextProps.translationRuntime.provider &&
    prevProps.translationRuntime.model === nextProps.translationRuntime.model &&
    prevProps.translationRuntime.endpoint === nextProps.translationRuntime.endpoint &&
    prevProps.isNew === nextProps.isNew &&
    prevProps.dataArticleId === nextProps.dataArticleId &&
    prevProps.onSelect === nextProps.onSelect &&
    prevProps.onOpenContextMenu === nextProps.onOpenContextMenu
  );
}

export const ArticleCard = memo(ArticleCardComponent, areEqual);
