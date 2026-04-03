import type React from "react";
import { useMemo, useState } from "react";
import { Search, Trash2, X } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import type { UserSettings } from "../types/news";
import {
  addSourceToBlacklist,
  normalizeSourceName,
  removeSourceFromBlacklist,
} from "../utils/sourceBlacklist";

interface SourceBlacklistModalProps {
  show: boolean;
  isDarkMode: boolean;
  settings: UserSettings;
  setSettings: Dispatch<SetStateAction<UserSettings>>;
  saveSetting: (key: string, value: string) => void;
  onClose: () => void;
}

export function SourceBlacklistModal({
  show,
  isDarkMode,
  settings,
  setSettings,
  saveSetting,
  onClose,
}: SourceBlacklistModalProps): React.JSX.Element | null {
  const [query, setQuery] = useState("");
  const [draftSource, setDraftSource] = useState("");

  const filteredSources = useMemo(() => {
    const normalizedQuery = normalizeSourceName(query);
    const sorted = [...settings.sourceBlacklist].sort((left, right) => left.localeCompare(right));
    if (!normalizedQuery) {
      return sorted;
    }

    return sorted.filter((source) => normalizeSourceName(source).includes(normalizedQuery));
  }, [query, settings.sourceBlacklist]);

  if (!show) {
    return null;
  }

  const updateBlacklist = (nextSources: string[]) => {
    setSettings((current) => ({ ...current, sourceBlacklist: nextSources }));
    saveSetting("sourceBlacklist", JSON.stringify(nextSources));
  };

  const addDraftSource = () => {
    const nextSources = addSourceToBlacklist(settings.sourceBlacklist, draftSource);
    if (nextSources === settings.sourceBlacklist) {
      return;
    }
    updateBlacklist(nextSources);
    setDraftSource("");
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={onClose} />
      <div
        className={`relative w-full max-w-2xl overflow-hidden rounded-3xl border shadow-2xl ${
          isDarkMode ? "border-zinc-800 bg-zinc-900 text-zinc-300" : "border-zinc-200 bg-zinc-150 text-zinc-800"
        }`}
      >
        <div
          className={`flex items-center justify-between border-b p-5 ${
            isDarkMode ? "border-zinc-800 bg-zinc-950/50" : "border-zinc-200 bg-zinc-150"
          }`}
        >
          <div>
            <p className={`text-[10px] font-bold uppercase tracking-widest ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>
              Media Outlet Blacklist
            </p>
            <h3 className="text-sm font-bold">Manage hidden news sources</h3>
          </div>
          <button type="button" onClick={onClose} className="hover:opacity-60" aria-label="Close media outlet blacklist manager">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />
              <input
                type="text"
                placeholder="Search source name"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className={`w-full rounded-lg border py-2 pl-9 pr-3 text-sm focus:outline-none ${
                  isDarkMode
                    ? "border-zinc-700 bg-zinc-800 text-zinc-100 placeholder-zinc-600"
                    : "border-zinc-300 bg-zinc-200 text-zinc-900 placeholder-zinc-500"
                }`}
              />
            </div>
            <button
              type="button"
              onClick={() => updateBlacklist([])}
              disabled={settings.sourceBlacklist.length === 0}
              className="rounded-lg bg-red-600 px-3 py-2 text-xs font-bold uppercase tracking-widest text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Clear All
            </button>
          </div>

          <div className={`max-h-64 overflow-y-auto rounded-xl border news-scroll ${isDarkMode ? "news-scroll-dark border-zinc-800" : "news-scroll-light border-zinc-200"}`}>
            {filteredSources.length === 0 ? (
              <p className={`p-4 text-sm ${isDarkMode ? "text-zinc-500" : "text-zinc-500"}`}>
                {settings.sourceBlacklist.length === 0 ? "No blacklisted sources yet." : "No sources match your search."}
              </p>
            ) : (
              <div className="divide-y divide-zinc-800/70">
                {filteredSources.map((source) => (
                  <div key={`blacklist-${normalizeSourceName(source)}`} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="truncate text-sm font-medium">{source}</span>
                    <button
                      type="button"
                      onClick={() => updateBlacklist(removeSourceFromBlacklist(settings.sourceBlacklist, source))}
                      className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-bold uppercase tracking-widest transition-colors ${
                        isDarkMode
                          ? "border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                          : "border-zinc-300 bg-zinc-150 text-zinc-700 hover:bg-zinc-200"
                      }`}
                    >
                      <Trash2 size={12} /> Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto]">
            <input
              type="text"
              placeholder="Add source name manually"
              value={draftSource}
              onChange={(event) => setDraftSource(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addDraftSource();
                }
              }}
              className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none ${
                isDarkMode
                  ? "border-zinc-700 bg-zinc-800 text-zinc-100 placeholder-zinc-600"
                  : "border-zinc-300 bg-zinc-200 text-zinc-900 placeholder-zinc-500"
              }`}
            />
            <button
              type="button"
              onClick={addDraftSource}
              className={`rounded-lg border px-3 py-2 text-xs font-bold uppercase tracking-widest transition-colors ${
                isDarkMode
                  ? "border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                  : "border-zinc-300 bg-zinc-150 text-zinc-700 hover:bg-zinc-200"
              }`}
            >
              Add Source
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
