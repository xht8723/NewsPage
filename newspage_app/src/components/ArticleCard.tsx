import { ChevronRight } from "lucide-react";
import type { LayoutMode } from "../constants/news";
import { useImageFallback } from "../hooks/useImageFallback";
import type { NewsArticle } from "../types/news";
import { getTagColor } from "../utils/newsMeta";

interface ArticleCardProps {
  item: NewsArticle;
  layout: LayoutMode;
  isDarkMode: boolean;
  sortMode: string;
  onSelect: (article: NewsArticle) => void;
  onOpenContextMenu: (article: NewsArticle, x: number, y: number) => void;
}

export function ArticleCard({
  item,
  layout,
  isDarkMode,
  sortMode,
  onSelect,
  onOpenContextMenu,
}: ArticleCardProps): React.JSX.Element {
  const isListLayout = layout === "list";
  const isCompactListLayout = layout === "compact_list";
  const onThumbnailError = useImageFallback("https://placehold.co/640x360/27272a/a1a1aa?text=News");

  return (
    <div
      data-card-context-menu="true"
      onClick={() => onSelect(item)}
      onContextMenu={(event) => {
        event.preventDefault();
        onOpenContextMenu(item, event.clientX, event.clientY);
      }}
      className={`group cursor-pointer rounded-2xl border transition-all hover:shadow-lg ${
        isDarkMode ? "border-zinc-800 bg-zinc-900 hover:border-zinc-600" : "border-zinc-200 bg-white hover:border-zinc-300"
      } ${isListLayout ? "flex flex-col gap-4 p-4 md:flex-row" : isCompactListLayout ? "flex flex-col gap-2 px-3 py-2.5" : "flex flex-col"}`}
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
          <span className={`rounded px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-white shadow-sm ${getTagColor(item.category)}`}>
            {item.category}
          </span>
          {sortMode === "score" && item.preferenceScore !== 0 && (
            <span
              title={`Relevance score: ${item.preferenceScore.toFixed(3)}`}
              className={`ml-auto rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${
                item.preferenceScore > 0
                  ? isDarkMode ? "bg-emerald-500/20 text-emerald-400" : "bg-emerald-100 text-emerald-700"
                  : isDarkMode ? "bg-red-500/20 text-red-400" : "bg-red-100 text-red-700"
              }`}
            >
              {item.preferenceScore > 0 ? "+" : ""}
              {(item.preferenceScore * 100).toFixed(0)}%
            </span>
          )}
        </div>
        <h3
          className={`${isCompactListLayout ? "mb-2 text-base" : "mb-3 text-lg"} font-bold leading-tight transition-colors ${
            isDarkMode ? "text-zinc-100 group-hover:text-white" : "text-zinc-900"
          }`}
        >
          {item.title}
        </h3>
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
          {item.snippet}
        </p>
        <div className="mt-auto flex items-center justify-between gap-3">
          <div className={`flex min-w-0 items-center gap-2 ${isCompactListLayout ? "text-[9px]" : "text-[10px]"} font-black uppercase tracking-widest ${
            isDarkMode ? "text-zinc-500" : "text-zinc-600"
          }`}>
            {item.sourceIconUrl ? (
              <img
                src={item.sourceIconUrl}
                alt={`${item.sourceName} icon`}
                className="h-4 w-4 rounded-sm object-contain"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            ) : null}
            <span className="truncate">{item.sourceName}</span>
          </div>
          <div
            className={`flex items-center ${isCompactListLayout ? "text-[9px]" : "text-[10px]"} font-black uppercase tracking-widest opacity-60 transition-opacity group-hover:opacity-100 ${
              isDarkMode ? "text-zinc-400" : "text-zinc-900"
            }`}
          >
            Open Brief <ChevronRight size={12} className="ml-1" />
          </div>
        </div>
      </div>
    </div>
  );
}
