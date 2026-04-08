import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface DebouncedSettingSaverController {
  saveSetting: (key: string, value: string) => void;
  cancelPendingSave: () => void;
  isPending: boolean;
}

export function useDebouncedSettingSaverController(delayMs: number = 500): DebouncedSettingSaverController {
  const timerRef = useRef<number | null>(null);
  const [isPending, setIsPending] = useState(false);

  const saveSetting = useCallback((key: string, value: string) => {
    // Cancel previous timer
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }

    // Mark as pending immediately for optimistic UI feedback
    setIsPending(true);

    timerRef.current = window.setTimeout(() => {
      void invoke("save_setting", { key, value });
      setIsPending(false);
      timerRef.current = null;
    }, delayMs);
  }, [delayMs]);

  const cancelPendingSave = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
      setIsPending(false);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  return { saveSetting, cancelPendingSave, isPending };
}
