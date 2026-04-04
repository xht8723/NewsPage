import type React from "react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
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
import { ChevronRight, GripVertical } from "lucide-react";
import type { FeedDefinition } from "../types/news";

interface FeedNavigationListProps {
  feeds: FeedDefinition[];
  selectedFeedId: string;
  isDarkMode: boolean;
  onSelectFeed: (feedId: string) => void;
  onReorderFeedByDrag: (orderedFeedIds: string[]) => Promise<void>;
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
}: FeedNavigationListProps): React.JSX.Element {
  const [activeFeedId, setActiveFeedId] = useState<string | null>(null);
  const [overFeedId, setOverFeedId] = useState<string | null>(null);
  const [previewFeeds, setPreviewFeeds] = useState<FeedDefinition[] | null>(null);
  const [isReleasing, setIsReleasing] = useState(false);

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

  return (
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
  );
});
