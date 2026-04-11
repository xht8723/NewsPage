import { useEffect, useMemo, useRef, useState } from "react";
import {
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import type { FeedDefinition } from "../types/article";

export interface FeedDragReorderControls {
  activeFeedId: string | null;
  overFeedId: string | null;
  isReleasing: boolean;
  orderedFeeds: FeedDefinition[];
  sensors: ReturnType<typeof useSensors>;
  handleDragStart: (event: DragStartEvent) => void;
  handleDragOver: (event: DragOverEvent) => void;
  handleDragEnd: (event: DragEndEvent) => Promise<void>;
  clearDragState: () => void;
}

export function useFeedDragReorder(
  feeds: FeedDefinition[],
  onReorderFeedByDrag: (orderedFeedIds: string[]) => Promise<void>,
): FeedDragReorderControls {
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
    const over = event.over ? String(event.over.id) : null;
    setOverFeedId(over);
    if (!event.over || activeFeedId === null) {
      return;
    }

    const activeId = String(event.active.id);
    if (activeId === over) {
      return;
    }

    setPreviewFeeds((current) => {
      const base = current ?? orderedFeedsRef.current;
      const sourceIndex = base.findIndex((feed) => feed.id === activeId);
      const targetIndex = base.findIndex((feed) => feed.id === over);
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

  return {
    activeFeedId,
    overFeedId,
    isReleasing,
    orderedFeeds,
    sensors,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    clearDragState,
  };
}
