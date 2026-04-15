import { memo, useMemo, useRef, useLayoutEffect, useCallback } from "react";
import { ArticleCard } from "./ArticleCard";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { NewsArticle, FeedSource } from "../types/article";
import type { LayoutMode } from "../constants/article";
import type { TranslationRuntimeConfig } from "../hooks/useLiveTranslation";
import { buildTagColorMap } from "../utils/articleMeta";
import { DotsSpinner } from "./DotsSpinner";

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
  isScoringLoading?: boolean;
  shiftingArticleId?: string | null;
  onSelectArticle: (article: NewsArticle) => void;
  onOpenContextMenu: (article: NewsArticle, x: number, y: number) => void;
}

function VirtualizedArticleListComponent({
  articles,
  feedSources,
  layout,
  isDarkMode,
  sortMode,
  liveTranslationEnabled,
  translationTargetLanguage,
  translationRuntime,
  isTransitioning,
  isScoringLoading,
  shiftingArticleId,
  onSelectArticle,
  onOpenContextMenu,
}: VirtualizedArticleListProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const prevPositions = useRef<Map<string, DOMRect>>(new Map());

  const tagColorMap = useMemo(() => buildTagColorMap(feedSources), [feedSources]);

  const snapshotPositions = useCallback(() => {
    if (!containerRef.current) return;
    const children = containerRef.current.querySelectorAll<HTMLElement>("[data-article-id]");
    const nextPositions = new Map<string, DOMRect>();
    for (const child of children) {
      const id = child.dataset.articleId;
      if (id) {
        nextPositions.set(id, child.getBoundingClientRect());
      }
    }
    prevPositions.current = nextPositions;
  }, []);

  useLayoutEffect(() => {
    if (!shiftingArticleId || !containerRef.current) return;
    if (!articles.some((a) => a.id === shiftingArticleId)) return;

    const container = containerRef.current;
    const children = container.querySelectorAll<HTMLElement>("[data-article-id]");

    for (const child of children) {
      const id = child.dataset.articleId;
      if (!id || id === shiftingArticleId) continue;

      const oldRect = prevPositions.current.get(id);
      if (!oldRect) continue;

      const newRect = child.getBoundingClientRect();
      const dx = oldRect.left - newRect.left;
      const dy = oldRect.top - newRect.top;

      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;

      child.style.transition = "none";
      child.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      child.style.willChange = "transform";
      child.style.zIndex = "1";

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          child.style.transition = "transform 300ms cubic-bezier(0.33, 1, 0.68, 1)";
          child.style.transform = "translate3d(0, 0, 0)";
          const onDone = () => {
            child.style.transition = "";
            child.style.transform = "";
            child.style.willChange = "";
            child.style.zIndex = "";
            child.removeEventListener("transitionend", onDone);
          };
          child.addEventListener("transitionend", onDone);
          setTimeout(onDone, 350);
        });
      });
    }

    const timer = setTimeout(snapshotPositions, 400);
    return () => clearTimeout(timer);
  }, [shiftingArticleId, snapshotPositions]);

  useLayoutEffect(() => {
    if (!shiftingArticleId) {
      snapshotPositions();
    }
  }, [articles, shiftingArticleId, snapshotPositions]);

  if (isScoringLoading) {
    return (
      <div className="flex flex-col items-center justify-center space-y-4 py-32 text-center opacity-40">
        <DotsSpinner size={48} className="text-zinc-500" />
        <div>
          <h3 className="text-lg font-bold">{t("feeds.calculatingScores")}</h3>
        </div>
      </div>
    );
  }

  if (articles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center space-y-4 py-32 text-center opacity-40">
        <Search size={48} className="text-zinc-500" />
        <div>
          <h3 className="text-lg font-bold">{t("feeds.noArticles")}</h3>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`
        ${isTransitioning ? "filter-content-transitioning" : "filter-content-ready"}
        ${layout === "grid" ? "grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3" : ""}
        ${layout === "list" ? "flex flex-col gap-4" : ""}
        ${layout === "compact_list" ? "flex flex-col gap-2" : ""}
      `}
    >
      {articles.map((item) => (
        <ArticleCard
          key={item.id}
          item={item}
          tagColorMap={tagColorMap}
          layout={layout}
          isDarkMode={isDarkMode}
          sortMode={sortMode}
          liveTranslationEnabled={liveTranslationEnabled}
          translationTargetLanguage={translationTargetLanguage}
          translationRuntime={translationRuntime}
          isNew={shiftingArticleId === item.id}
          onSelect={onSelectArticle}
          onOpenContextMenu={onOpenContextMenu}
          dataArticleId={item.id}
        />
      ))}
    </div>
  );
}

export const VirtualizedArticleList = memo(VirtualizedArticleListComponent);
