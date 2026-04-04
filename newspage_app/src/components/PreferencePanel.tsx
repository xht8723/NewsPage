interface PreferencePanelProps {
  className?: string;
  isDarkMode: boolean;
  sortMode: string;
  isRelevanceMode: boolean;
  isEmbeddingReady: boolean;
  likedConcepts: string;
  dislikedConcepts: string;
  onSetSortMode: (mode: "date" | "score") => void;
  onSetPreferenceConcepts: (field: "likedConcepts" | "dislikedConcepts", value: string) => void;
}

export function PreferencePanel({
  className = "",
  isDarkMode,
  sortMode,
  isRelevanceMode,
  isEmbeddingReady,
  likedConcepts,
  dislikedConcepts,
  onSetSortMode,
  onSetPreferenceConcepts,
}: PreferencePanelProps): React.JSX.Element {
  return (
    <div className={`rounded-2xl border p-3 ${isDarkMode ? "border-zinc-800 bg-zinc-950/50" : "border-zinc-200 bg-zinc-150"} ${className}`.trim()}>
      <p className={`mb-3 text-[10px] font-bold uppercase tracking-widest ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>Sort by:</p>
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
          Date
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
          Vector
        </button>
      </div>

      <div
        className={`grid overflow-hidden transition-[grid-template-rows,opacity,margin] duration-300 ease-out ${
          isRelevanceMode ? "mt-3 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0 pointer-events-none"
        }`}
      >
        <div className="min-h-0 space-y-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium opacity-70">Topics I enjoy</label>
            <input
              type="text"
              placeholder="indie games, retro hardware, game preservation"
              value={likedConcepts}
              onChange={(e) => onSetPreferenceConcepts("likedConcepts", e.target.value)}
              className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none ${
                isDarkMode
                  ? "border-zinc-700 bg-zinc-800 text-zinc-100 placeholder-zinc-600"
                  : "border-zinc-300 bg-zinc-200 text-zinc-900 placeholder-zinc-500"
              }`}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium opacity-70">Topics to avoid</label>
            <input
              type="text"
              placeholder="mobile games, NFTs, battle royale"
              value={dislikedConcepts}
              onChange={(e) => onSetPreferenceConcepts("dislikedConcepts", e.target.value)}
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
