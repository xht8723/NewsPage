import type React from "react";
import { useCallback } from "react";

export function useImageFallback(fallbackUrl: string): (event: React.SyntheticEvent<HTMLImageElement, Event>) => void {
  return useCallback((event: React.SyntheticEvent<HTMLImageElement, Event>) => {
    event.currentTarget.onerror = null;
    event.currentTarget.src = fallbackUrl;
  }, [fallbackUrl]);
}
