import { invoke } from "@tauri-apps/api/core";

export const settingsService = {
  load: (): Promise<Record<string, string>> => invoke("load_settings"),

  save: (key: string, value: string): Promise<void> =>
    invoke("save_setting", { key, value }),

  setAutoStart: (enabled: boolean): Promise<void> =>
    invoke("set_auto_start", { enabled }),

  setMinimizeToTray: (enabled: boolean): Promise<void> =>
    invoke("set_minimize_to_tray", { enabled }),

  cleanupImgCache: (): Promise<void> => invoke("cleanup_img_cache"),
};