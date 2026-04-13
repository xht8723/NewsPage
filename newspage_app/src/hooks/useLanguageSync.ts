import { useEffect } from "react";
import { useSettingsStore } from "../stores/settingsStore";
import i18n from "../i18n";

export function useLanguageSync(): void {
  const uiLanguage = useSettingsStore((s) => s.settings.uiLanguage);
  const saveSetting = useSettingsStore((s) => s.saveSetting);

  useEffect(() => {
    if (!i18n.isInitialized) return;

    if (!uiLanguage) {
      const detected = i18n.language;
      const resolved = detected === "zh-CN" || detected.startsWith("zh") ? "zh-CN" : "en";
      void i18n.changeLanguage(resolved);
      saveSetting("uiLanguage", resolved);
      return;
    }

    if (i18n.language !== uiLanguage) {
      void i18n.changeLanguage(uiLanguage);
    }
  }, [uiLanguage, saveSetting]);
}
