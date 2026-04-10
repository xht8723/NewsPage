import { useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface DebouncedSettingSaverController {
  saveSetting: (key: string, value: string) => void;
  cancelPendingSave: () => void;
}

export function useDebouncedSettingSaverController(delayMs: number = 500): DebouncedSettingSaverController {
  const timerRef = useRef<number | null>(null);

  const saveSetting = useCallback((key: string, value: string) => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }

    timerRef.current = window.setTimeout(() => {
      void invoke("save_setting", { key, value });
      timerRef.current = null;
    }, delayMs);
  }, [delayMs]);

  const cancelPendingSave = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
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

  return { saveSetting, cancelPendingSave };
}
