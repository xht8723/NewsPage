import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../stores/settingsStore";
import { Languages } from "lucide-react";

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "zh-CN", label: "中文" },
] as const;

export function LanguageSwitcher({ isDarkMode }: { isDarkMode: boolean }) {
  const { t, i18n } = useTranslation();
  const saveSetting = useSettingsStore((s) => s.saveSetting);

  const handleChange = (lang: string) => {
    void i18n.changeLanguage(lang);
    saveSetting("uiLanguage", lang);
  };

  return (
    <div className="flex items-center gap-2">
      <Languages size={14} className="opacity-60" />
      <select
        value={i18n.language.startsWith("zh") ? "zh-CN" : i18n.language}
        onChange={(e) => handleChange(e.target.value)}
        className={`border px-2 py-1 text-xs rounded-lg focus:outline-none ${
          isDarkMode
            ? "border-zinc-700 bg-zinc-800 text-zinc-200"
            : "border-zinc-300 bg-zinc-100 text-zinc-800"
        }`}
        aria-label={t("settings.language")}
      >
        {LANGUAGES.map((lang) => (
          <option key={lang.value} value={lang.value}>
            {lang.label}
          </option>
        ))}
      </select>
    </div>
  );
}