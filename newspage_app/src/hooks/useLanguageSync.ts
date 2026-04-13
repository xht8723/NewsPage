import { useEffect } from "react";
import { useSettingsStore } from "../stores/settingsStore";
import i18n from "../i18n";

export function useLanguageSync(): void {
  const settings = useSettingsStore((s) => s.settings);
  const saveSetting = useSettingsStore((s) => s.saveSetting);

  useEffect(() => {
    const targetLang = settings.uiLanguage || i18n.language;
    if (i18n.language !== targetLang && i18n.isInitialized) {
      void i18n.changeLanguage(targetLang);
    }
  }, [settings.uiLanguage]);

  useEffect(() => {
    if (!settings.uiLanguage && i18n.isInitialized) {
      const detected = i18n.language;
      if (detected === "zh-CN" || detected.startsWith("zh")) {
        void i18n.changeLanguage("zh-CN");
        saveSetting("uiLanguage", "zh-CN");
      } else {
        void i18n.changeLanguage("en");
        saveSetting("uiLanguage", "en");
      }
    }
  }, [settings.uiLanguage, saveSetting]);
}