import { useEffect, useState } from "react";

interface PanelTransitionState {
  isMounted: boolean;
  isClosing: boolean;
}

export function usePanelTransition(isOpen: boolean, exitDurationMs = 170): PanelTransitionState {
  const [isMounted, setIsMounted] = useState(isOpen);
  const [isClosing, setIsClosing] = useState(false);

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

  return { isMounted, isClosing };
}
