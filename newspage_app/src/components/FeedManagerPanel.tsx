import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, ChevronRight, Eye, EyeOff, GripVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { TOPIC_CATEGORIES } from "../constants/article";
import type { FeedDefinition, FeedSource } from "../types/article";

function pillClass(active: boolean, isDarkMode: boolean): string {
  return `rounded-md border px-2 py-1 text-[10px] font-bold uppercase tracking-wide transition-all duration-200 hover:scale-[1.03] ${
    active
      ? isDarkMode
        ? "border-cyan-500/80 bg-cyan-600/12 text-cyan-200 shadow-[0_0_8px_rgba(8,145,178,0.28)]"
        : "border-emerald-600 bg-emerald-600/10 text-emerald-800 shadow-[0_0_7px_rgba(5,150,105,0.24)]"
      : isDarkMode
        ? "border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-cyan-800/70 hover:shadow-[0_0_7px_rgba(82,82,91,0.26)]"
        : "border-zinc-300 bg-zinc-100 text-zinc-600 hover:border-emerald-400/80 hover:shadow-[0_0_7px_rgba(113,113,122,0.18)]"
  }`;
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
  const [draftName, setDraftName] = useState("");
  const [renamingFeedId, setRenamingFeedId] = useState<string | null>(null);
  const [renamingValue, setRenamingValue] = useState("");
  const [expandedFeedIds, setExpandedFeedIds] = useState<Record<string, boolean>>({});
  const [activeFeedId, setActiveFeedId] = useState<string | null>(null);
  const [overFeedId, setOverFeedId] = useState<string | null>(null);
  const [previewFeeds, setPreviewFeeds] = useState<FeedDefinition[] | null>(null);
  const [isReleasing, setIsReleasing] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    }),
  );

  const orderedFeedsFromProps = useMemo(
    () => [...feeds].sort((left, right) => left.sort_order - right.sort_order),
    [feeds],
  );

  const orderedFeeds = previewFeeds ?? orderedFeedsFromProps;
  const dragStartOrderRef = useRef<string[]>([]);
  const orderedFeedsRef = useRef<FeedDefinition[]>(orderedFeeds);

  useEffect(() => {
    orderedFeedsRef.current = orderedFeeds;
  }, [orderedFeeds]);

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

  const handleDragStart = (event: DragStartEvent) => {
    const startedId = String(event.active.id);
    setIsReleasing(false);
    setActiveFeedId(startedId);
    setOverFeedId(startedId);
    setPreviewFeeds(orderedFeedsRef.current);
    dragStartOrderRef.current = orderedFeedsRef.current.map((feed) => feed.id);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const overId = event.over ? String(event.over.id) : null;
    setOverFeedId(overId);
    if (!event.over || activeFeedId === null) {
      return;
    }

    const activeId = String(event.active.id);
    if (activeId === overId) {
      return;
    }

    setPreviewFeeds((current) => {
      const base = current ?? orderedFeedsRef.current;
      const sourceIndex = base.findIndex((feed) => feed.id === activeId);
      const targetIndex = base.findIndex((feed) => feed.id === overId);
      if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
        return base;
      }
      return arrayMove(base, sourceIndex, targetIndex);
    });
  };

  const clearDragState = () => {
    setIsReleasing(false);
    setActiveFeedId(null);
    setOverFeedId(null);
    setPreviewFeeds(null);
    dragStartOrderRef.current = [];
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const finalizedOrder = orderedFeedsRef.current.map((feed) => feed.id);
    const startOrder = dragStartOrderRef.current;
    const changed =
      event.over
      && startOrder.length === finalizedOrder.length
      && finalizedOrder.some((feedId, index) => feedId !== startOrder[index]);

    if (!changed) {
      clearDragState();
      return;
    }

    // Keep preview order while persisting so release does not snap back.
    setIsReleasing(true);
    setActiveFeedId(null);
    setOverFeedId(null);

    try {
      await onReorderFeedByDrag(finalizedOrder);
    } finally {
      clearDragState();
    }
  };

  return (
    <div className={`mb-4 space-y-3 rounded-2xl border p-3 ${isDarkMode ? "border-zinc-800 bg-zinc-950/70" : "border-zinc-200 bg-zinc-150"}`}>
      <div className="space-y-2 rounded-xl border border-zinc-700/40 p-2">
        <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Create Feed</p>
        <input
          type="text"
          value={draftName}
          onChange={(event) => setDraftName(event.target.value)}
          placeholder="Feed name"
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
          <Plus size={12} /> Add Feed
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
                    title="Drag to reorder"
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
                    <span className="truncate text-xs font-bold">{feed.name}</span>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => toggleFeedExpanded(feed.id)}
                    className="flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-0.5 text-left"
                    title={isExpanded ? "Collapse" : "Expand"}
                  >
                    <ChevronRight size={13} className={`shrink-0 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                    <span className="truncate text-xs font-bold">{feed.name}</span>
                  </button>
                )}

                {renamingFeedId !== feed.id && feed.id !== "feed-all" && (
                  <button
                    type="button"
                    onClick={() => {
                      setRenamingFeedId(feed.id);
                      setRenamingValue(feed.name);
                    }}
                    className={`rounded border p-1 transition-colors ${
                      isDarkMode
                        ? "border-zinc-700/50 text-zinc-400 hover:border-cyan-700/70 hover:bg-zinc-800 hover:text-zinc-200"
                        : "border-zinc-300 text-zinc-500 hover:border-emerald-400/80 hover:bg-zinc-200 hover:text-zinc-700"
                    }`}
                    title="Rename"
                    aria-label={`Rename ${feed.name}`}
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
                  title={feed.is_visible ? "Hide feed" : "Show feed"}
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
                <div className="min-h-0 space-y-0">
                  <div className="flex flex-wrap gap-1">
                    {TOPIC_CATEGORIES.map((category) => {
                      const key = category.toLowerCase();
                      const active = normalizedNewsCategories.includes(key);
                      return (
                        <button
                          key={`${feed.id}-${category}`}
                          type="button"
                          onClick={async () => {
                            const next = active
                              ? normalizedNewsCategories.filter((item) => item !== key)
                              : [...normalizedNewsCategories, key];
                            await onSetFeedCategories(feed.id, next, normalizedRssCategories);
                          }}
                          className={pillClass(active, isDarkMode)}
                        >
                          {category}
                        </button>
                      );
                    })}
                  </div>

                  <p className={`mt-3 mb-1 text-[10px] font-bold uppercase tracking-widest ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>RSS Sources</p>
                  {sortedSources.length === 0 ? (
                    <p className="text-xs text-zinc-500">No RSS sources configured.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {sortedSources.map((source) => {
                        const key = `${source.source_type}:${source.source_ref}`;
                        const sourceCategory = source.display_name.toLowerCase();
                        const active = normalizedRssCategories.includes(sourceCategory);
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={async () => {
                              const next = active
                                ? normalizedRssCategories.filter((item) => item !== sourceCategory)
                                : [...normalizedRssCategories, sourceCategory];
                              await onSetFeedCategories(feed.id, normalizedNewsCategories, next);
                            }}
                            title={active ? `Remove "${source.display_name}" articles from this feed` : `Include "${source.display_name}" articles in this feed`}
                            className={pillClass(active, isDarkMode)}
                          >
                            {source.display_name}
                          </button>
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
