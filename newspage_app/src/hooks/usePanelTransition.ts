import { useMemo, useEffect, useState } from "react";

interface PanelTransitionState {
  isMounted: boolean;
  isClosing: boolean;
  transitionStyle: React.CSSProperties;
}

export interface PanelTransitionOptions {
  exitDurationMs?: number;
  easingCurve?: "default" | "spring" | "smooth";
  enableGpuAccel?: boolean;
}

/**
 * Hook for orchestrating smooth panel mount/unmount with controlled animations
 * Provides performance hints (will-change, transform hints) for GPU acceleration
 * Supports both new options object and legacy duration parameter for backward compatibility
 */
export function usePanelTransition(
  isOpen: boolean,
  optionsOrDuration?: PanelTransitionOptions | number,
): PanelTransitionState {
  // Handle backward compatibility: if second arg is a number, treat as exitDurationMs
  const options: PanelTransitionOptions =
    typeof optionsOrDuration === "number"
      ? { exitDurationMs: optionsOrDuration }
      : (optionsOrDuration ?? {});

  const { exitDurationMs = 170, easingCurve = "default", enableGpuAccel = true } = options;
  const [isMounted, setIsMounted] = useState(isOpen);
  const [isClosing, setIsClosing] = useState(false);

  // Memoized easing curve strings to avoid recreating during renders
  const easingMap: Record<string, string> = useMemo(
    () => ({
      default: "cubic-bezier(0.22, 1, 0.36, 1)",
      spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
      smooth: "cubic-bezier(0.25, 0.46, 0.45, 0.94)",
    }),
    [],
  );

  // Memoized transition style with GPU hints for better performance
  const transitionStyle: React.CSSProperties = useMemo(
    () => ({
      ...(enableGpuAccel && {
        willChange: "transform, opacity",
        backfaceVisibility: "hidden",
        perspective: 1000,
      } as React.CSSProperties),
      transition: `opacity ${exitDurationMs}ms ${easingMap[easingCurve]}, transform ${exitDurationMs}ms ${easingMap[easingCurve]}`,
    }),
    [enableGpuAccel, exitDurationMs, easingCurve, easingMap],
  );

  useEffect(() => {
    if (isOpen) {
      setIsMounted(true);
      setIsClosing(false);
      return;
    }

    if (!isMounted) {
      return;
    }

    setIsClosing(true);
    const timer = window.setTimeout(() => {
      setIsMounted(false);
      setIsClosing(false);
    }, exitDurationMs);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isOpen, isMounted, exitDurationMs]);

  return { isMounted, isClosing, transitionStyle };
}
