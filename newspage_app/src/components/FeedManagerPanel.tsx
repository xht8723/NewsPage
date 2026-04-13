import type React from "react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DndContext,
  closestCenter,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, ChevronRight, Eye, EyeOff, GripVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { TOPIC_CATEGORIES } from "../constants/article";
import type { FeedDefinition, FeedSource } from "../types/article";
import { getFeedDisplayName } from "../utils/feedNames";
import { useFeedDragReorder } from "../hooks/useFeedDragReorder";

const CATEGORY_HEX: Record<string, string> = {
  World: "#0ea5e9",
  Nation: "#06b6d4",
  Business: "#10b981",
  Technology: "#6366f1",
  Entertainment: "#d946ef",
  Science: "#f59e0b",
  Sports: "#f97316",
  Health: "#14b8a6",
  Anime: "#ec4899",
  Gaming: "#8b5cf6",
};

function inactivePillClass(isDarkMode: boolean): string {
  return `rounded-md border px-2 py-1 text-[10px] font-bold uppercase tracking-wide transition-all duration-200 hover:scale-[1.03] ${
    isDarkMode
      ? "border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-cyan-800/70 hover:shadow-[0_0_7px_rgba(82,82,91,0.26)]"
      : "border-zinc-300 bg-zinc-100 text-zinc-600 hover:border-emerald-400/80 hover:shadow-[0_0_7px_rgba(113,113,122,0.18)]"
  }`;
}

function RssPillButton({ active, tagColor, isDarkMode, title, children, onClick }: {
  active: boolean;
  tagColor: string;
  isDarkMode: boolean;
  title: string;
  children: React.ReactNode;
  onClick: () => void;
}): React.JSX.Element {
  const [hovered, setHovered] = useState(false);
  const hex = tagColor.trim() || "#71717a";

  if (active) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        className="rounded px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-white shadow-sm transition-all duration-200 hover:scale-[1.03]"
        style={{ backgroundColor: hex }}
      >
        {children}
      </button>
    );
  }

  const hoverStyle = hovered
    ? { backgroundColor: hex + "18", borderColor: hex + "70", color: hex, boxShadow: `0 0 7px ${hex}30` }
    : undefined;

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
        className={inactivePillClass(isDarkMode)}
      style={hoverStyle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {children}
    </button>
  );
}

interface FeedManagerPanelProps {
  feeds: FeedDefinition[];
  feedSources: FeedSource[];
  isDarkMode: boolean;
  onCreateFeed: (name: string, newsCategories: string[], rssCategories: string[]) => Promise<FeedDefinition | null>;
  onRenameFeed: (feedId: string, name: string) => Promise<void>;
  onDeleteFeed: (feedId: string) => Promise<void>;
  onToggleFeedVisibility: (feedId: string, isVisible: boolean) => Promise<void>;
  onSetFeedCategories: (feedId: string, newsCategories: string[], rssCategories: string[]) => Promise<void>;
  onReorderFeed: (feedId: string, direction: "up" | "down") => Promise<void>;
  onReorderFeedByDrag: (orderedFeedIds: string[]) => Promise<void>;
}

interface SortableFeedCardProps {
  id: string;
  disabled: boolean;
  isDarkMode: boolean;
  showInsertionLine: boolean;
  isReleasing: boolean;
  children: (params: {
    attributes: DraggableAttributes;
    listeners: DraggableSyntheticListeners | undefined;
    setActivatorNodeRef: (element: HTMLElement | null) => void;
    isDragging: boolean;
  }) => React.JSX.Element;
}

function SortableFeedCard({
  id,
  disabled,
  isDarkMode,
  showInsertionLine,
  isReleasing,
  children,
}: SortableFeedCardProps): React.JSX.Element {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={[
        "relative rounded-xl border p-2 transition-[border-color,background-color,opacity] duration-150",
        isDarkMode ? "border-zinc-800 bg-zinc-900/70" : "border-zinc-200 bg-zinc-50",
        isDragging && !isReleasing ? "opacity-50" : "",
      ].filter(Boolean).join(" ")}
    >
      {showInsertionLine && (
        <div
          className={`pointer-events-none absolute left-2 right-2 -top-0.5 h-0.5 rounded-full ${
            isDarkMode ? "bg-cyan-400/90" : "bg-cyan-500"
          }`}
        />
      )}
      {children({ attributes, listeners, setActivatorNodeRef, isDragging })}
    </div>
  );
}

export function FeedManagerPanel({
  feeds,
  feedSources,
  isDarkMode,
  onCreateFeed,
  onRenameFeed,
  onDeleteFeed,
  onToggleFeedVisibility,
  onSetFeedCategories,
  onReorderFeed,
  onReorderFeedByDrag,
}: FeedManagerPanelProps): React.JSX.Element {
  const { t } = useTranslation();
  const [draftName, setDraftName] = useState("");
  const [renamingFeedId, setRenamingFeedId] = useState<string | null>(null);
  const [renamingValue, setRenamingValue] = useState("");
  const [expandedFeedIds, setExpandedFeedIds] = useState<Record<string, boolean>>({});

  const orderedFeedsFromProps = useMemo(
    () => [...feeds].sort((left, right) => left.sort_order - right.sort_order),
    [feeds],
  );

  const {
    activeFeedId,
    overFeedId,
    isReleasing,
    orderedFeeds,
    sensors,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    clearDragState,
  } = useFeedDragReorder(orderedFeedsFromProps, onReorderFeedByDrag);

  const sortedSources = useMemo(
    () => [...feedSources].filter((s) => s.enabled).sort((left, right) => left.display_name.localeCompare(right.display_name)),
    [feedSources],
  );

  const toggleFeedExpanded = (feedId: string) => {
    setExpandedFeedIds((current) => ({
      ...current,
      [feedId]: !current[feedId],
    }));
  };

  return (
    <div className={`mb-4 space-y-3 rounded-2xl border p-3 ${isDarkMode ? "border-zinc-800 bg-zinc-950/70" : "border-zinc-200 bg-zinc-150"}`}>
      <div className="space-y-2 rounded-xl border border-zinc-700/40 p-2">
        <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{t("feedManager.createFeed")}</p>
        <input
          type="text"
          value={draftName}
          onChange={(event) => setDraftName(event.target.value)}
          placeholder={t("feedManager.feedName")}
          className={`w-full rounded-lg border px-2 py-1.5 text-xs focus:outline-none ${
            isDarkMode
              ? "border-zinc-700 bg-zinc-800 text-zinc-100 placeholder-zinc-500"
              : "border-zinc-300 bg-zinc-100 text-zinc-900 placeholder-zinc-500"
          }`}
        />
        <button
          type="button"
          onClick={async () => {
            const createdFeed = await onCreateFeed(draftName, [], []);
            if (createdFeed) {
              setExpandedFeedIds((current) => ({
                ...current,
                [createdFeed.id]: true,
              }));
            }
            setDraftName("");
          }}
          className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest ${
            isDarkMode
              ? "border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
              : "border-zinc-300 bg-zinc-200 text-zinc-700 hover:bg-zinc-300"
          }`}
        >
          <Plus size={12} /> {t("feedManager.addFeed")}
        </button>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={clearDragState}
      >
        <SortableContext items={orderedFeeds.map((feed) => feed.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {orderedFeeds.map((feed, index) => {
              const normalizedNewsCategories = feed.news_categories.map((item) => item.toLowerCase());
              const normalizedRssCategories = feed.rss_categories.map((item) => item.toLowerCase());
              const isExpanded = !!expandedFeedIds[feed.id];
              const canDrag = orderedFeeds.length > 1;
              const showInsertionLine = activeFeedId !== null && overFeedId === feed.id && activeFeedId !== feed.id;

              return (
                <SortableFeedCard
                  key={feed.id}
                  id={feed.id}
                  disabled={!canDrag}
                  isDarkMode={isDarkMode}
                  showInsertionLine={showInsertionLine}
                  isReleasing={isReleasing}
                >
                  {({ attributes, listeners, setActivatorNodeRef }) => (
                    <>
              <div className="mb-2 flex items-center gap-1">
                {canDrag && (
                  <span
                    ref={setActivatorNodeRef}
                    {...attributes}
                    {...listeners}
                    className={`shrink-0 cursor-grab active:cursor-grabbing ${isDarkMode ? "text-zinc-600 hover:text-zinc-400" : "text-zinc-400 hover:text-zinc-600"}`}
                    title={t("feedManager.dragToReorder")}
                  >
                    <GripVertical size={13} />
                  </span>
                )}
                {renamingFeedId === feed.id ? (
                  <input
                    type="text"
                    autoFocus
                    value={renamingValue}
                    onChange={(event) => setRenamingValue(event.target.value)}
                    onBlur={async () => {
                      await onRenameFeed(feed.id, renamingValue);
                      setRenamingFeedId(null);
                    }}
                    onKeyDown={async (event) => {
                      if (event.key === "Enter") {
                        await onRenameFeed(feed.id, renamingValue);
                        setRenamingFeedId(null);
                      }
                    }}
                    className={`flex-1 rounded border px-2 py-1 text-xs focus:outline-none ${
                      isDarkMode
                        ? "border-zinc-700 bg-zinc-800 text-zinc-100"
                        : "border-zinc-300 bg-zinc-100 text-zinc-900"
                    }`}
                  />
                ) : feed.id === "feed-all" ? (
                  <span className="flex min-w-0 flex-1 items-center gap-1 px-1 py-0.5">
                    {!canDrag && <span className="w-[13px] shrink-0" />}
                    <span className="truncate text-xs font-bold">{getFeedDisplayName(feed.id, feed.name, t)}</span>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => toggleFeedExpanded(feed.id)}
                    className="flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-0.5 text-left"
                    title={isExpanded ? t("feedManager.collapse") : t("feedManager.expand")}
                  >
                    <ChevronRight size={13} className={`shrink-0 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                    <span className="truncate text-xs font-bold">{getFeedDisplayName(feed.id, feed.name, t)}</span>
                  </button>
                )}

                {renamingFeedId !== feed.id && feed.id !== "feed-all" && (
                  <button
                    type="button"
                    onClick={() => {
                      setRenamingFeedId(feed.id);
                      setRenamingValue(getFeedDisplayName(feed.id, feed.name, t));
                    }}
                    className={`rounded border p-1 transition-colors ${
                      isDarkMode
                        ? "border-zinc-700/50 text-zinc-400 hover:border-cyan-700/70 hover:bg-zinc-800 hover:text-zinc-200"
                        : "border-zinc-300 text-zinc-500 hover:border-emerald-400/80 hover:bg-zinc-200 hover:text-zinc-700"
                    }`}
                    title={t("feedManager.rename")}
                    aria-label={`${t("feedManager.rename")} ${feed.name}`}
                  >
                    <Pencil size={12} />
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => void onReorderFeed(feed.id, "up")}
                  disabled={index === 0}
                  className={`rounded border p-1 transition-colors disabled:opacity-30 ${
                    isDarkMode
                      ? "border-zinc-700/50 text-zinc-400 hover:border-cyan-700/70 hover:bg-zinc-800 hover:text-zinc-200"
                      : "border-zinc-300 text-zinc-500 hover:border-emerald-400/80 hover:bg-zinc-200 hover:text-zinc-700"
                  }`}
                >
                  <ArrowUp size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => void onReorderFeed(feed.id, "down")}
                  disabled={index === orderedFeeds.length - 1}
                  className={`rounded border p-1 transition-colors disabled:opacity-30 ${
                    isDarkMode
                      ? "border-zinc-700/50 text-zinc-400 hover:border-cyan-700/70 hover:bg-zinc-800 hover:text-zinc-200"
                      : "border-zinc-300 text-zinc-500 hover:border-emerald-400/80 hover:bg-zinc-200 hover:text-zinc-700"
                  }`}
                >
                  <ArrowDown size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => void onToggleFeedVisibility(feed.id, !feed.is_visible)}
                  title={feed.is_visible ? t("feedManager.hideFeed") : t("feedManager.showFeed")}
                  aria-label={feed.is_visible ? `Hide ${feed.name}` : `Show ${feed.name}`}
                  className={`rounded border p-1 transition-colors ${
                    feed.is_visible
                      ? isDarkMode
                        ? "border-emerald-500/40 text-emerald-400 hover:border-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300"
                        : "border-emerald-500/50 text-emerald-700 hover:border-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-800"
                      : isDarkMode
                        ? "border-zinc-700/50 text-zinc-500 hover:border-cyan-700/70 hover:bg-zinc-800 hover:text-zinc-300"
                        : "border-zinc-300 text-zinc-500 hover:border-emerald-400/80 hover:bg-zinc-200 hover:text-zinc-700"
                  }`}
                >
                  {feed.is_visible ? <Eye size={12} /> : <EyeOff size={12} />}
                </button>
                {feed.id !== "feed-all" && (
                  <button
                    type="button"
                    onClick={() => void onDeleteFeed(feed.id)}
                    className={`rounded border p-1 transition-colors ${
                      isDarkMode
                        ? "border-red-500/40 text-red-400 hover:border-red-400 hover:bg-red-500/10 hover:text-red-300"
                        : "border-red-500/50 text-red-600 hover:border-red-600 hover:bg-red-500/10 hover:text-red-700"
                    }`}
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>

              <div
                className={`grid overflow-hidden transition-[grid-template-rows,opacity,margin] duration-300 ease-out ${
                  isExpanded ? "mt-2 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0 pointer-events-none"
                }`}
              >
                <div className="min-h-0 space-y-0 p-1">
                  <div className="flex flex-wrap gap-1">
                    {TOPIC_CATEGORIES.map((category) => {
                      const key = category.toLowerCase();
                      const active = normalizedNewsCategories.includes(key);
                      return (
                        <RssPillButton
                          key={`${feed.id}-${category}`}
                          active={active}
                          tagColor={CATEGORY_HEX[category] || "#71717a"}
                          isDarkMode={isDarkMode}
                          title={active ? t("feedManager.removeFromFeed", { category }) : t("feedManager.includeInFeed", { category })}
                          onClick={async () => {
                            const next = active
                              ? normalizedNewsCategories.filter((item) => item !== key)
                              : [...normalizedNewsCategories, key];
                            await onSetFeedCategories(feed.id, next, normalizedRssCategories);
                          }}
                        >
                          {category}
                        </RssPillButton>
                      );
                    })}
                  </div>

                  <p className={`mt-3 mb-1 text-[10px] font-bold uppercase tracking-widest ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>{t("feedManager.rssSources")}</p>
                  {sortedSources.length === 0 ? (
                    <p className="text-xs text-zinc-500">{t("feedManager.noRssSources")}</p>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {sortedSources.map((source) => {
                        const key = `${source.source_type}:${source.source_ref}`;
                        const sourceCategory = source.display_name.toLowerCase();
                        const active = normalizedRssCategories.includes(sourceCategory);
                        return (
                          <RssPillButton
                            key={key}
                            active={active}
                            tagColor={source.tag_color}
                            isDarkMode={isDarkMode}
                            title={active ? `Remove "${source.display_name}" articles from this feed` : `Include "${source.display_name}" articles in this feed`}
                            onClick={async () => {
                              const next = active
                                ? normalizedRssCategories.filter((item) => item !== sourceCategory)
                                : [...normalizedRssCategories, sourceCategory];
                              await onSetFeedCategories(feed.id, normalizedNewsCategories, next);
                            }}
                          >
                            {source.display_name}
                          </RssPillButton>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
                    </>
                  )}
                </SortableFeedCard>
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
