import type React from "react";
import type { Dispatch, SetStateAction } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import type { UserSettings } from "../types/article";
import { TOPIC_CATEGORIES } from "../constants/article";
import { usePanelTransition } from "../hooks/usePanelTransition";

interface CategoryLimitsModalProps {
  show: boolean;
  isDarkMode: boolean;
  settings: UserSettings;
  setSettings: Dispatch<SetStateAction<UserSettings>>;
  saveSetting: (key: string, value: string) => void;
  onClose: () => void;
}

export function CategoryLimitsModal({
  show,
  isDarkMode,
  settings,
  setSettings,
  saveSetting,
  onClose,
}: CategoryLimitsModalProps): React.JSX.Element | null {
  const { isMounted, isClosing } = usePanelTransition(show, 170);

  if (!isMounted) {
    return null;
  }

  const updateLimits = (next: Record<string, number>) => {
    setSettings((s) => ({ ...s, perCategoryNewsLimits: next }));
    saveSetting("perCategoryNewsLimits", JSON.stringify(next));
  };

  const handleChange = (category: string, raw: string) => {
    const trimmed = raw.trim();
    const next = { ...settings.perCategoryNewsLimits };
    if (trimmed === "" || trimmed === "-") {
      // Empty means "use global limit" — remove the override
      delete next[category];
    } else {
      const val = Math.min(100, Math.max(0, Math.round(Number(trimmed))));
      if (!Number.isNaN(val)) {
        next[category] = val;
      }
    }
    updateLimits(next);
  };

  const handleResetAll = () => {
    updateLimits({});
  };

  const inputClass = `number-dial-${isDarkMode ? "dark" : "light"} w-full rounded-lg border px-3 py-2 text-sm font-semibold focus:outline-none ${
    isDarkMode
      ? "border-zinc-700 bg-zinc-800 text-zinc-100 placeholder-zinc-500"
      : "border-zinc-300 bg-zinc-200 text-zinc-900 placeholder-zinc-400"
  }`;

  return (
    <div className={`${isClosing ? "popup-overlay-out" : "popup-overlay"} fixed inset-0 z-[120] flex items-center justify-center p-4`}>
      <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={onClose} />
      <div
        className={`${isClosing ? "popup-panel-out" : "popup-panel"} relative w-full max-w-md overflow-hidden rounded-3xl border shadow-2xl ${
          isDarkMode ? "border-zinc-800 bg-zinc-900 text-zinc-300" : "border-zinc-200 bg-zinc-150 text-zinc-800"
        }`}
      >
        {/* Header */}
        <div
          className={`flex items-center justify-between border-b p-5 ${
            isDarkMode ? "border-zinc-800 bg-zinc-950/50" : "border-zinc-200 bg-zinc-150"
          }`}
        >
          <div className="flex items-center gap-2">
            <SlidersHorizontal size={18} className="text-zinc-500" />
            <h3 className="text-base font-bold uppercase tracking-widest">Per-Category Limits</h3>
          </div>
          <button type="button" onClick={onClose} className="hover:opacity-60" aria-label="Close per-category limits">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className={`max-h-[calc(100vh-12rem)] overflow-y-auto p-5 space-y-4 news-scroll ${isDarkMode ? "news-scroll-dark" : "news-scroll-light"}`}>
          <p className={`text-xs ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>
            Set how many articles to pull per category. <strong>0</strong> = pull all available.
            Leave blank to use the global limit (<strong>{settings.newsLimit}</strong>).
          </p>

          <div className="space-y-2">
            {TOPIC_CATEGORIES.map((category) => {
              const override = settings.perCategoryNewsLimits[category];
              const displayValue = override !== undefined ? String(override) : "";
              return (
                <div key={category} className="flex items-center gap-3">
                  <span className={`w-28 shrink-0 text-xs font-medium ${isDarkMode ? "text-zinc-300" : "text-zinc-700"}`}>
                    {category}
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={displayValue}
                    placeholder={`Global (${settings.newsLimit})`}
                    onChange={(e) => handleChange(category, e.target.value)}
                    className={inputClass}
                  />
                </div>
              );
            })}
          </div>

          {/* Reset all */}
          <button
            type="button"
            onClick={handleResetAll}
            className={`mt-2 w-full rounded-lg border px-3 py-2 text-xs font-semibold transition-opacity hover:opacity-70 ${
              isDarkMode
                ? "border-zinc-700 bg-zinc-800 text-zinc-300"
                : "border-zinc-300 bg-zinc-200 text-zinc-700"
            }`}
          >
            Reset all to global limit
          </button>
        </div>
      </div>
    </div>
  );
}
