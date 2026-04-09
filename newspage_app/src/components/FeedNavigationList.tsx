import type React from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { ChevronRight, EyeOff, GripVertical, Pencil } from "lucide-react";
import type { FeedDefinition } from "../types/article";
import { usePanelTransition } from "../hooks/usePanelTransition";

interface FeedNavigationListProps {
  feeds: FeedDefinition[];
  selectedFeedId: string;
  isDarkMode: boolean;
  onSelectFeed: (feedId: string) => void;
  onReorderFeedByDrag: (orderedFeedIds: string[]) => Promise<void>;
  onRenameFeed: (feedId: string, name: string) => Promise<void>;
  onToggleFeedVisibility: (feedId: string, isVisible: boolean) => Promise<void>;
}

interface SortableNavRowProps {
  id: string;
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

function SortableNavRow({
  id,
  isDarkMode,
  showInsertionLine,
  isReleasing,
  children,
}: SortableNavRowProps): React.JSX.Element {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} className="relative">
      {showInsertionLine && (
        <div
          className={`pointer-events-none absolute left-1 right-1 -top-0.5 h-0.5 rounded-full ${
            isDarkMode ? "bg-cyan-400/90" : "bg-cyan-500"
          }`}
        />
      )}
      <div className={isDragging && !isReleasing ? "opacity-50 transition-opacity duration-150" : "transition-opacity duration-150"}>
        {children({ attributes, listeners, setActivatorNodeRef, isDragging })}
      </div>
    </div>
  );
}

export const FeedNavigationList = memo(function FeedNavigationListComponent({
  feeds,
  selectedFeedId,
  isDarkMode,
  onSelectFeed,
  onReorderFeedByDrag,
  onRenameFeed,
  onToggleFeedVisibility,
}: FeedNavigationListProps): React.JSX.Element {
  const [activeFeedId, setActiveFeedId] = useState<string | null>(null);
  const [overFeedId, setOverFeedId] = useState<string | null>(null);
  const [previewFeeds, setPreviewFeeds] = useState<FeedDefinition[] | null>(null);
  const [isReleasing, setIsReleasing] = useState(false);

  const [feedContextMenu, setFeedContextMenu] = useState<{ feedId: string; x: number; y: number } | null>(null);
  const [feedContextMenuClosing, setFeedContextMenuClosing] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renamingFeed, setRenamingFeed] = useState<FeedDefinition | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const { isMounted: renameModalMounted, isClosing: renameModalClosing } = usePanelTransition(renameOpen, 160);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    }),
  );

  const orderedFeeds = useMemo(
    () => previewFeeds ?? feeds,
    [feeds, previewFeeds],
  );

  const dragStartOrderRef = useRef<string[]>([]);
  const orderedFeedsRef = useRef<FeedDefinition[]>(orderedFeeds);

  useEffect(() => {
    orderedFeedsRef.current = orderedFeeds;
  }, [orderedFeeds]);

  const clearDragState = () => {
    setIsReleasing(false);
    setActiveFeedId(null);
    setOverFeedId(null);
    setPreviewFeeds(null);
    dragStartOrderRef.current = [];
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

    setIsReleasing(true);
    setActiveFeedId(null);
    setOverFeedId(null);

    try {
      await onReorderFeedByDrag(finalizedOrder);
    } finally {
      clearDragState();
    }
  };

  const closeContextMenu = useCallback(() => {
    setFeedContextMenuClosing(true);
    window.setTimeout(() => {
      setFeedContextMenu(null);
      setFeedContextMenuClosing(false);
    }, 140);
  }, []);

  const handleHideFeed = useCallback(async (feedId: string) => {
    closeContextMenu();
    setIsBusy(true);
    try {
      await onToggleFeedVisibility(feedId, false);
    } finally {
      setIsBusy(false);
    }
  }, [closeContextMenu, onToggleFeedVisibility]);

  const handleOpenRename = useCallback((feed: FeedDefinition) => {
    setFeedContextMenu(null);
    setFeedContextMenuClosing(false);
    setRenamingFeed(feed);
    setRenameValue(feed.name);
    setRenameError(null);
    setRenameOpen(true);
  }, []);

  const handleRenameCancel = useCallback(() => {
    setRenameOpen(false);
  }, []);

  const handleRenameConfirm = useCallback(async () => {
    if (!renamingFeed || isBusy) return;
    const trimmed = renameValue.trim();
    if (!trimmed) {
      setRenameError("Name cannot be empty.");
      return;
    }
    const duplicate = feeds.some(
      (f) => f.id !== renamingFeed.id && f.name.toLowerCase() === trimmed.toLowerCase(),
    );
    if (duplicate) {
      setRenameError("A feed with this name already exists.");
      return;
    }
    setIsBusy(true);
    try {
      await onRenameFeed(renamingFeed.id, trimmed);
      setRenameOpen(false);
    } catch {
      setRenameError("Rename failed. Please try again.");
    } finally {
      setIsBusy(false);
    }
  }, [renamingFeed, isBusy, renameValue, feeds, onRenameFeed]);

  useEffect(() => {
    if (renameModalMounted) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renameModalMounted]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (renameOpen) {
        handleRenameCancel();
      } else if (feedContextMenu) {
        closeContextMenu();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [renameOpen, feedContextMenu, handleRenameCancel, closeContextMenu]);

  const contextMenuFeed = feedContextMenu
    ? feeds.find((f) => f.id === feedContextMenu.feedId) ?? null
    : null;

  return (
    <>
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={clearDragState}
    >
      <SortableContext items={orderedFeeds.map((feed) => feed.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-1.5">
          {orderedFeeds.map((feed) => {
            const showInsertionLine = activeFeedId !== null && overFeedId === feed.id && activeFeedId !== feed.id;

            return (
              <SortableNavRow
                key={feed.id}
                id={feed.id}
                isDarkMode={isDarkMode}
                showInsertionLine={showInsertionLine}
                isReleasing={isReleasing}
              >
                {({ attributes, listeners, setActivatorNodeRef }) => (
                  <div className="relative">
                    <button
                      onClick={() => onSelectFeed(feed.id)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setFeedContextMenu({ feedId: feed.id, x: e.clientX, y: e.clientY });
                      }}
                      className={`group flex w-full items-center gap-1 rounded-lg px-1.5 py-2 text-left text-sm font-medium transition-all select-none ${
                        selectedFeedId === feed.id
                          ? isDarkMode
                            ? "bg-zinc-800 text-zinc-100 ring-1 ring-zinc-700"
                            : "bg-zinc-200 text-zinc-900 ring-1 ring-zinc-300"
                          : "text-zinc-500 hover:bg-zinc-800/30 hover:text-zinc-300"
                      }`}
                    >
                      <span
                        ref={setActivatorNodeRef}
                        {...attributes}
                        {...listeners}
                        className={`shrink-0 cursor-grab active:cursor-grabbing ${isDarkMode ? "text-zinc-600 hover:text-zinc-400" : "text-zinc-400 hover:text-zinc-600"}`}
                        title="Drag to reorder"
                      >
                        <GripVertical size={13} />
                      </span>
                      <span className="flex-1">{feed.name}</span>
                      {selectedFeedId === feed.id && <ChevronRight size={14} className="shrink-0 mr-1" />}
                    </button>
                  </div>
                )}
              </SortableNavRow>
            );
          })}
        </div>
      </SortableContext>
    </DndContext>
    {feedContextMenu !== null && contextMenuFeed && (
      <div
        className={`${feedContextMenuClosing ? "popup-overlay-out" : "popup-overlay"} fixed inset-0 z-50`}
        onClick={closeContextMenu}
      >
        <div
          className={`${feedContextMenuClosing ? "popup-panel-pop-out" : "popup-panel-pop"} absolute min-w-[180px] rounded-xl border p-2 shadow-2xl ${
            isDarkMode ? "border-zinc-700 bg-zinc-900 text-zinc-200" : "border-zinc-300 bg-zinc-150 text-zinc-900"
          }`}
          style={{ left: feedContextMenu.x, top: feedContextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            disabled={isBusy}
            onClick={() => void handleHideFeed(contextMenuFeed.id)}
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold transition-colors ${
              isDarkMode ? "hover:bg-zinc-800" : "hover:bg-zinc-200"
            } disabled:cursor-not-allowed disabled:opacity-50`}
          >
            <EyeOff size={13} />
            <span>Hide this feed</span>
          </button>
          {contextMenuFeed.id !== "feed-all" && (
            <button
              type="button"
              disabled={isBusy}
              onClick={() => handleOpenRename(contextMenuFeed)}
              className={`mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold transition-colors ${
                isDarkMode ? "hover:bg-zinc-800" : "hover:bg-zinc-200"
              } disabled:cursor-not-allowed disabled:opacity-50`}
            >
              <Pencil size={13} />
              <span>Rename</span>
            </button>
          )}
        </div>
      </div>
    )}
    {renameModalMounted && renamingFeed && (
      <div
        className={`${renameModalClosing ? "popup-overlay-out" : "popup-overlay"} fixed inset-0 z-50 flex items-center justify-center`}
        onClick={handleRenameCancel}
      >
        <div
          className={`${renameModalClosing ? "popup-panel-out" : "popup-panel"} w-80 rounded-2xl border p-5 shadow-2xl ${
            isDarkMode ? "border-zinc-700 bg-zinc-900 text-zinc-100" : "border-zinc-300 bg-white text-zinc-900"
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-4 flex items-center gap-2">
            <Pencil size={15} className="shrink-0" />
            <span className="text-sm font-semibold">Rename Feed</span>
          </div>
          <input
            ref={renameInputRef}
            type="text"
            value={renameValue}
            onChange={(e) => {
              setRenameValue(e.target.value);
              setRenameError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !isBusy) {
                void handleRenameConfirm();
              }
            }}
            className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 ${
              renameError
                ? "border-red-500 focus:ring-red-400/40"
                : isDarkMode
                  ? "border-zinc-700 bg-zinc-800 focus:ring-cyan-400/40"
                  : "border-zinc-300 bg-zinc-50 focus:ring-cyan-500/40"
            }`}
            maxLength={80}
            autoComplete="off"
            spellCheck={false}
          />
          {renameError && (
            <p className="mt-1.5 text-xs text-red-400">{renameError}</p>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={handleRenameCancel}
              disabled={isBusy}
              className={`rounded-lg px-4 py-1.5 text-xs font-bold transition-colors ${
                isDarkMode ? "hover:bg-zinc-800 text-zinc-400" : "hover:bg-zinc-100 text-zinc-600"
              } disabled:opacity-50`}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleRenameConfirm()}
              disabled={isBusy || !renameValue.trim()}
              className={`rounded-lg px-4 py-1.5 text-xs font-bold transition-colors ${
                isDarkMode
                  ? "bg-cyan-500 hover:bg-cyan-400 text-white disabled:bg-zinc-700 disabled:text-zinc-500"
                  : "bg-cyan-600 hover:bg-cyan-500 text-white disabled:bg-zinc-300 disabled:text-zinc-500"
              } disabled:cursor-not-allowed`}
            >
              {isBusy ? "Saving..." : "Confirm"}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
});
