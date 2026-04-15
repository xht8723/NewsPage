import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../stores/settingsStore";

interface PreferencePanelProps {
  className?: string;
  isDarkMode: boolean;
  sortMode: string;
  isRelevanceMode: boolean;
  likedConcepts: string;
  dislikedConcepts: string;
  onSetSortMode: (mode: "date" | "score") => void;
  onSetPreferenceConcepts: (field: "likedConcepts" | "dislikedConcepts", value: string) => void;
}

function PreferencePanelComponent({
  className = "",
  isDarkMode,
  sortMode,
  isRelevanceMode,
  likedConcepts,
  dislikedConcepts,
  onSetSortMode,
  onSetPreferenceConcepts,
}: PreferencePanelProps): React.JSX.Element {
  const { t } = useTranslation();
  const isEmbeddingReady = useSettingsStore((s) => s.isEmbeddingReady);

  const [localLiked, setLocalLiked] = useState(likedConcepts);
  const [localDisliked, setLocalDisliked] = useState(dislikedConcepts);
  const debounceRef = useRef<Record<"likedConcepts" | "dislikedConcepts", number | null>>({
    likedConcepts: null,
    dislikedConcepts: null,
  });

  useEffect(() => { setLocalLiked(likedConcepts); }, [likedConcepts]);
  useEffect(() => { setLocalDisliked(dislikedConcepts); }, [dislikedConcepts]);
  useEffect(() => {
    const ref = debounceRef.current;
    return () => {
      if (ref.likedConcepts) window.clearTimeout(ref.likedConcepts);
      if (ref.dislikedConcepts) window.clearTimeout(ref.dislikedConcepts);
    };
  }, []);

  const handleConceptChange = useCallback(
    (field: "likedConcepts" | "dislikedConcepts", value: string) => {
      if (field === "likedConcepts") setLocalLiked(value);
      else setLocalDisliked(value);
      const ref = debounceRef.current;
      if (ref[field]) window.clearTimeout(ref[field]);
      ref[field] = window.setTimeout(() => {
        onSetPreferenceConcepts(field, value);
        ref[field] = null;
      }, 50);
    },
    [onSetPreferenceConcepts],
  );
  return (
    <div className={`rounded-2xl border p-3 ${isDarkMode ? "border-zinc-800 bg-zinc-950/50" : "border-zinc-200 bg-zinc-150"} ${className}`.trim()}>
      <p className={`mb-3 text-[10px] font-bold uppercase tracking-widest ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>{t("preferences.sortBy")}</p>
      <div className={`flex items-center gap-0.5 rounded-full border p-1 text-xs font-semibold tracking-wide antialiased ${
        isDarkMode ? "border-zinc-800 bg-zinc-900" : "border-zinc-200 bg-zinc-150"
      }`}>
        <button
          onClick={() => onSetSortMode("date")}
          className={`flex-1 rounded-full px-3 py-1.5 leading-none transition-all ${
            sortMode === "date"
              ? isDarkMode
                ? "bg-zinc-200 text-zinc-900 shadow"
                : "bg-zinc-800 text-white shadow"
              : isDarkMode
                ? "text-zinc-500 hover:text-zinc-300"
                : "text-zinc-500 hover:text-zinc-700"
          }`}
        >
          {t("preferences.date")}
        </button>
        <button
          onClick={() => isEmbeddingReady && onSetSortMode("score")}
          disabled={!isEmbeddingReady}
          className={`flex-1 rounded-full px-3 py-1.5 leading-none transition-all ${
            !isEmbeddingReady
              ? isDarkMode
                ? "cursor-not-allowed opacity-40 text-zinc-600"
                : "cursor-not-allowed opacity-40 text-zinc-400"
              : sortMode === "score"
              ? isDarkMode
                ? "bg-zinc-200 text-zinc-900 shadow"
                : "bg-zinc-800 text-white shadow"
              : isDarkMode
                ? "text-zinc-500 hover:text-zinc-300"
                : "text-zinc-500 hover:text-zinc-700"
          }`}
        >
          {t("preferences.topic")}
        </button>
      </div>

      <div
        className={`grid overflow-hidden transition-[grid-template-rows,opacity,margin] duration-300 ease-out ${
          isRelevanceMode ? "mt-3 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0 pointer-events-none"
        }`}
      >
        <div className="min-h-0 space-y-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium opacity-70">{t("preferences.topicsEnjoy")}</label>
            <input
              type="text"
              placeholder={t("preferences.likedPlaceholder")}
              value={localLiked}
              onChange={(e) => handleConceptChange("likedConcepts", e.target.value)}
              className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none ${
                isDarkMode
                  ? "border-zinc-700 bg-zinc-800 text-zinc-100 placeholder-zinc-600"
                  : "border-zinc-300 bg-zinc-200 text-zinc-900 placeholder-zinc-500"
              }`}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium opacity-70">{t("preferences.topicsAvoid")}</label>
            <input
              type="text"
              placeholder={t("preferences.dislikedPlaceholder")}
              value={localDisliked}
              onChange={(e) => handleConceptChange("dislikedConcepts", e.target.value)}
              className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none ${
                isDarkMode
                  ? "border-zinc-700 bg-zinc-800 text-zinc-100 placeholder-zinc-600"
                  : "border-zinc-300 bg-zinc-200 text-zinc-900 placeholder-zinc-500"
              }`}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export const PreferencePanel = memo(PreferencePanelComponent);
