import { useCallback, useEffect, useRef, useState } from "react";

interface ProgressiveRenderOptions {
  threshold?: number;
  batchSize?: number;
}

export function useProgressiveRender<T>(
  items: T[],
  options?: ProgressiveRenderOptions,
): { visibleItems: T[]; sentinelRef: (node: HTMLDivElement | null) => void; hasMore: boolean } {
  const threshold = options?.threshold ?? 30;
  const batchSize = options?.batchSize ?? 30;
  const needsProgressive = items.length > threshold;

  const [visibleCount, setVisibleCount] = useState(() =>
    needsProgressive ? threshold : items.length,
  );

  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelElRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setVisibleCount(needsProgressive ? threshold : items.length);
  }, [items, threshold, needsProgressive]);

  const detachObserver = useCallback(() => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
  }, []);

  const sentinelRef = useCallback(
    (node: HTMLDivElement | null) => {
      detachObserver();
      sentinelElRef.current = node;

      if (!node || !needsProgressive) return;

      const observer = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting) {
            setVisibleCount((prev) => Math.min(prev + batchSize, items.length));
          }
        },
        { rootMargin: "200px" },
      );
      observer.observe(node);
      observerRef.current = observer;
    },
    [detachObserver, needsProgressive, batchSize, items.length],
  );

  useEffect(() => detachObserver, [detachObserver]);

  return {
    visibleItems: needsProgressive ? items.slice(0, visibleCount) : items,
    sentinelRef,
    hasMore: needsProgressive && visibleCount < items.length,
  };
}
