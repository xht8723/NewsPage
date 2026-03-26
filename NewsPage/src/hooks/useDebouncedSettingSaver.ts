import { useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface DebounceTimerApi {
  setTimeout: (handler: () => void, delayMs: number) => number;
  clearTimeout: (id: number) => void;
}

export interface DebouncedSettingScheduler {
  schedule: (key: string, value: string) => void;
  cancel: () => void;
}

export function createDebouncedSettingScheduler(
  saveNow: (key: string, value: string) => void,
  delayMs: number,
  timerApi: DebounceTimerApi,
): DebouncedSettingScheduler {
  let timerId: number | null = null;

  const cancel = () => {
    if (timerId !== null) {
      timerApi.clearTimeout(timerId);
      timerId = null;
    }
  };

  const schedule = (key: string, value: string) => {
    cancel();
    timerId = timerApi.setTimeout(() => {
      saveNow(key, value);
    }, delayMs);
  };

  return { schedule, cancel };
}

export function useDebouncedSettingSaver(delayMs: number = 500): (key: string, value: string) => void {
  const timerRef = useRef<number | null>(null);

  const saveSetting = useCallback((key: string, value: string) => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }

    timerRef.current = window.setTimeout(() => {
      void invoke("save_setting", { key, value });
    }, delayMs);
  }, [delayMs]);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  return saveSetting;
}
