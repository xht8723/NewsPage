import { useMemo } from "react";
import { List } from "react-window";
import { ArticleCard } from "./ArticleCard";
import { Search } from "lucide-react";
import type { NewsArticle, FeedSource } from "../types/news";
import type { LayoutMode } from "../constants/news";
import type { TranslationRuntimeConfig } from "../hooks/useLiveTranslation";

interface VirtualizedArticleListProps {
  articles: NewsArticle[];
  feedSources: FeedSource[];
  layout: LayoutMode;
  isDarkMode: boolean;
  sortMode: string;
  liveTranslationEnabled: boolean;
  translationTargetLanguage: "en" | "zh-CN";
  translationRuntime: TranslationRuntimeConfig;
  isTransitioning: boolean;
  onSelectArticle: (article: NewsArticle) => void;
  onOpenContextMenu: (article: NewsArticle, x: number, y: number) => void;
}

/**
 * Virtual scrolling component for rendering large article lists efficiently.
 * Automatically switches between virtual rendering (100+ articles) and standard rendering for smaller lists.
 * Only renders visible items in viewport + buffer for smooth scrolling.
 */
export function VirtualizedArticleList({
  articles,
  feedSources,
  layout,
  isDarkMode,
  sortMode,
  liveTranslationEnabled,
  translationTargetLanguage,
  translationRuntime,
  isTransitioning,
  onSelectArticle,
  onOpenContextMenu,
}: VirtualizedArticleListProps) {
  // Use virtualization for 100+ articles, standard rendering for smaller lists
  const useVirtualization = articles.length > 100;

  // Calculate item height based on layout
  const itemHeight = useMemo(() => {
    switch (layout) {
      case "compact_list":
        return 80; // ~1.5 lines of text + padding
      case "list":
        return 240; // Horizontal layout with image
      default: // grid
        return 360; // Square cards with full content
    }
  }, [layout]);

  // Render empty state
  if (articles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center space-y-4 py-32 text-center opacity-40">
        <Search size={48} className="text-zinc-500" />
        <div>
          <h3 className="text-lg font-bold">No articles yet.</h3>
        </div>
      </div>
    );
  }

  // Standard rendering for small lists (<100 articles)
  if (!useVirtualization) {
    return (
      <div
        className={`
          filter-content ${isTransitioning ? "filter-content-transitioning" : "filter-content-ready"}
          ${layout === "grid" ? "grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3" : ""}
          ${layout === "list" ? "flex flex-col gap-4" : ""}
          ${layout === "compact_list" ? "flex flex-col gap-2" : ""}
        `}
      >
        {articles.map((item) => (
          <ArticleCard
            key={item.id}
            item={item}
            feedSources={feedSources}
            layout={layout}
            isDarkMode={isDarkMode}
            sortMode={sortMode}
            liveTranslationEnabled={liveTranslationEnabled}
            translationTargetLanguage={translationTargetLanguage}
            translationRuntime={translationRuntime}
            onSelect={onSelectArticle}
            onOpenContextMenu={onOpenContextMenu}
          />
        ))}
      </div>
    );
  }

  // Virtualized rendering for large lists (100+ articles)
  // Calculate available height dynamically
  const containerHeight = typeof window !== "undefined" ? window.innerHeight - 200 : 600;

  return (
    <List
      rowCount={articles.length}
      rowHeight={itemHeight}
      overscanCount={5}
      style={{ height: containerHeight, width: "100%" }}
      rowComponent={({ index, style, ariaAttributes }) => {
        const item = articles[index];
        if (!item) return null;

        return (
          <div style={style} className="px-2" {...ariaAttributes}>
            <ArticleCard
              item={item}
              feedSources={feedSources}
              layout={layout}
              isDarkMode={isDarkMode}
              sortMode={sortMode}
              liveTranslationEnabled={liveTranslationEnabled}
              translationTargetLanguage={translationTargetLanguage}
              translationRuntime={translationRuntime}
              onSelect={onSelectArticle}
              onOpenContextMenu={onOpenContextMenu}
            />
          </div>
        );
      }}
      rowProps={{}}
    />
  );
}
