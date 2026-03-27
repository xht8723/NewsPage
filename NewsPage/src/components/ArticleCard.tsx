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
      } ${layout === "list" ? "flex flex-col gap-4 p-4 md:flex-row" : "flex flex-col"}`}
    >
      <div
        className={`${
          layout === "list" ? "h-44 w-full md:h-auto md:w-56 md:flex-shrink-0" : "h-44 w-full"
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
      <div className={`p-6 ${layout === "list" ? "md:py-2" : ""} flex flex-1 flex-col`}>
        <div className="mb-4 flex items-center gap-2">
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
        <div className="mb-4 flex flex-wrap gap-1.5">
          {item.tags.map((tag, tagIndex) => (
            <span key={`${item.id}-tag-${tagIndex}`} className="rounded bg-zinc-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-zinc-500">
              {tag}
            </span>
          ))}
        </div>
        <h3
          className={`text-lg mb-3 font-bold leading-tight transition-colors ${
            isDarkMode ? "text-zinc-100 group-hover:text-white" : "text-zinc-900"
          }`}
        >
          {item.title}
        </h3>
        <p className={`mb-5 text-sm leading-relaxed ${isDarkMode ? "text-zinc-400" : "text-zinc-600"}`}>{item.snippet}</p>
        <div className="mt-auto flex items-center justify-between gap-3">
          <div className={`flex min-w-0 items-center gap-2 text-[10px] font-black uppercase tracking-widest ${
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
            className={`flex items-center text-[10px] font-black uppercase tracking-widest opacity-60 transition-opacity group-hover:opacity-100 ${
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
