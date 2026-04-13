import { useLayoutEffect, type RefObject } from "react";

export function useClampedMenuPosition(
  ref: RefObject<HTMLElement | null>,
  x: number,
  y: number,
  margin = 8
) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    let left = x;
    let top = y;

    if (left + rect.width > window.innerWidth - margin) {
      left = window.innerWidth - rect.width - margin;
    }
    if (top + rect.height > window.innerHeight - margin) {
      top = window.innerHeight - rect.height - margin;
    }
    if (left < margin) left = margin;
    if (top < margin) top = margin;

    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [ref, x, y, margin]);
}
