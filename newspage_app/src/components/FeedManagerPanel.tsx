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
import { TOPIC_CATEGORIES } from "../constants/news";
import type { FeedDefinition, FeedSource } from "../types/news";

function pillClass(active: boolean, isDarkMode: boolean): string {
  return `rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${
    active
      ? isDarkMode
        ? "border-cyan-500/70 bg-cyan-500/20 text-cyan-200"
        : "border-cyan-500 bg-cyan-100 text-cyan-700"
      : isDarkMode
        ? "border-zinc-700 bg-zinc-900 text-zinc-400"
        : "border-zinc-300 bg-zinc-100 text-zinc-600"
  }`;
}

interface FeedManagerPanelProps {
  feeds: FeedDefinition[];
  feedSources: FeedSource[];
  isDarkMode: boolean;
  onCreateFeed: (name: string, categories: string[]) => Promise<void>;
  onRenameFeed: (feedId: string, name: string) => Promise<void>;
  onDeleteFeed: (feedId: string) => Promise<void>;
  onToggleFeedVisibility: (feedId: string, isVisible: boolean) => Promise<void>;
  onSetFeedCategories: (feedId: string, categories: string[]) => Promise<void>;
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
  const [draftCategories, setDraftCategories] = useState<string[]>(["world"]);
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
    () => [...feedSources].sort((left, right) => left.display_name.localeCompare(right.display_name)),
    [feedSources],
  );

  const toggleFeedExpanded = (feedId: string) => {
    setExpandedFeedIds((current) => ({
      ...current,
      [feedId]: !current[feedId],
    }));
  };

  const toggleDraftCategory = (category: string) => {
    setDraftCategories((current) => {
      if (current.includes(category)) {
        if (current.length === 1) {
          return current;
        }
        return current.filter((item) => item !== category);
      }
      return [...current, category];
    });
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
        <div className="flex flex-wrap gap-1">
          {TOPIC_CATEGORIES.map((category) => {
            const key = category.toLowerCase();
            const active = draftCategories.includes(key);
            return (
              <button
                key={`draft-${category}`}
                type="button"
                onClick={() => toggleDraftCategory(key)}
                className={pillClass(active, isDarkMode)}
              >
                {category}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={async () => {
            await onCreateFeed(draftName, draftCategories);
            setDraftName("");
            setDraftCategories(["world"]);
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
              const normalizedCategories = feed.categories.map((item) => item.toLowerCase());
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
                    className="rounded border border-zinc-700/50 p-1 text-zinc-400"
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
                  className="rounded border border-zinc-700/50 p-1 text-zinc-400 disabled:opacity-30"
                >
                  <ArrowUp size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => void onReorderFeed(feed.id, "down")}
                  disabled={index === orderedFeeds.length - 1}
                  className="rounded border border-zinc-700/50 p-1 text-zinc-400 disabled:opacity-30"
                >
                  <ArrowDown size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => void onToggleFeedVisibility(feed.id, !feed.is_visible)}
                  title={feed.is_visible ? "Hide feed" : "Show feed"}
                  aria-label={feed.is_visible ? `Hide ${feed.name}` : `Show ${feed.name}`}
                  className={`rounded border p-1 ${
                    feed.is_visible
                      ? "border-emerald-500/40 text-emerald-400"
                      : "border-zinc-700/50 text-zinc-500"
                  }`}
                >
                  {feed.is_visible ? <Eye size={12} /> : <EyeOff size={12} />}
                </button>
                {feed.id !== "feed-all" && (
                  <button
                    type="button"
                    onClick={() => void onDeleteFeed(feed.id)}
                    className="rounded border border-red-500/40 p-1 text-red-400"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>

              {isExpanded && (
                <>
                  <div className="flex flex-wrap gap-1">
                    {TOPIC_CATEGORIES.map((category) => {
                      const key = category.toLowerCase();
                      const active = normalizedCategories.includes(key);
                      return (
                        <button
                          key={`${feed.id}-${category}`}
                          type="button"
                          onClick={async () => {
                            const next = active
                              ? normalizedCategories.filter((item) => item !== key)
                              : [...normalizedCategories, key];
                            if (next.length === 0) {
                              return;
                            }
                            await onSetFeedCategories(feed.id, next);
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
                        const active = normalizedCategories.includes(sourceCategory);
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={async () => {
                              const next = active
                                ? normalizedCategories.filter((item) => item !== sourceCategory)
                                : [...normalizedCategories, sourceCategory];
                              if (next.length === 0) {
                                return;
                              }
                              await onSetFeedCategories(feed.id, next);
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
                </>
              )}
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
