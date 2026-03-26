import { describe, expect, it, vi } from "vitest";
import { createDebouncedSettingScheduler, type DebounceTimerApi } from "./useDebouncedSettingSaver";

function createVitestTimerApi(): DebounceTimerApi {
  return {
    setTimeout: (handler: () => void, delayMs: number) => Number(setTimeout(handler, delayMs)),
    clearTimeout: (id: number) => clearTimeout(id),
  };
}

describe("createDebouncedSettingScheduler", () => {
  it("fires only the last scheduled save", () => {
    vi.useFakeTimers();
    const saveNow = vi.fn<(key: string, value: string) => void>();
    const scheduler = createDebouncedSettingScheduler(saveNow, 500, createVitestTimerApi());

    scheduler.schedule("sortMode", "date");
    vi.advanceTimersByTime(300);
    scheduler.schedule("sortMode", "score");
    vi.advanceTimersByTime(499);
    expect(saveNow).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(saveNow).toHaveBeenCalledTimes(1);
    expect(saveNow).toHaveBeenCalledWith("sortMode", "score");
    vi.useRealTimers();
  });

  it("cancels pending save", () => {
    vi.useFakeTimers();
    const saveNow = vi.fn<(key: string, value: string) => void>();
    const scheduler = createDebouncedSettingScheduler(saveNow, 500, createVitestTimerApi());

    scheduler.schedule("ollamaModel", "qwen2.5:3b");
    scheduler.cancel();
    vi.advanceTimersByTime(500);

    expect(saveNow).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
