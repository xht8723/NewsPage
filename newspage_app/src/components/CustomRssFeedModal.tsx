import type React from "react";
import { useEffect, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import type { UserSettings } from "../types/news";
import { addCustomRssFeed, normalizeRssFeedUrl, removeCustomRssFeed } from "../utils/rssSettings";

interface CustomRssFeedModalProps {
  show: boolean;
  isDarkMode: boolean;
  settings: UserSettings;
  setSettings: Dispatch<SetStateAction<UserSettings>>;
  saveSetting: (key: string, value: string) => void;
  onClose: () => void;
}

export function CustomRssFeedModal({
  show,
  isDarkMode,
  settings,
  setSettings,
  saveSetting,
  onClose,
}: CustomRssFeedModalProps): React.JSX.Element | null {
  const [draftFeed, setDraftFeed] = useState("");

  useEffect(() => {
    if (show) {
      setDraftFeed("");
    }
  }, [show]);

  if (!show) {
    return null;
  }

  const updateFeeds = (nextFeeds: string[]) => {
    setSettings((current) => ({ ...current, customRssFeeds: nextFeeds }));
    saveSetting("customRssFeeds", JSON.stringify(nextFeeds));
  };

  const addFeed = () => {
    const nextFeeds = addCustomRssFeed(settings.customRssFeeds, draftFeed);
    if (nextFeeds === settings.customRssFeeds) {
      return;
    }

    updateFeeds(nextFeeds);
    setDraftFeed("");
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
              Custom RSS Feed
            </p>
            <h3 className="text-sm font-bold">Manage saved RSS feed links</h3>
          </div>
          <button type="button" onClick={onClose} className="hover:opacity-60" aria-label="Close custom RSS feed settings">
            <X size={18} />
          </button>
        </div>

        <div className={`max-h-[calc(100vh-12rem)] space-y-4 overflow-y-auto p-5 news-scroll ${isDarkMode ? "news-scroll-dark" : "news-scroll-light"}`}>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto]">
            <input
              type="text"
              placeholder="example.com/feed.xml"
              value={draftFeed}
              onChange={(event) => setDraftFeed(event.target.value)}
              onBlur={() => setDraftFeed((current) => normalizeRssFeedUrl(current))}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addFeed();
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
              onClick={addFeed}
              className={`inline-flex items-center justify-center gap-1 rounded-lg border px-3 py-2 text-xs font-bold uppercase tracking-widest transition-colors ${
                isDarkMode
                  ? "border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                  : "border-zinc-300 bg-zinc-200 text-zinc-700 hover:bg-zinc-300"
              }`}
            >
              <Plus size={12} /> Add Feed
            </button>
          </div>

          <div className={`overflow-hidden rounded-xl border ${isDarkMode ? "border-zinc-800" : "border-zinc-200"}`}>
            {settings.customRssFeeds.length === 0 ? (
              <p className={`p-4 text-sm ${isDarkMode ? "text-zinc-500" : "text-zinc-500"}`}>
                No custom RSS feeds saved yet.
              </p>
            ) : (
              <div className="divide-y divide-zinc-800/20">
                {settings.customRssFeeds.map((feed) => (
                  <div key={feed} className="flex items-center justify-between gap-3 px-4 py-3">
                    <span className="min-w-0 break-all text-sm">{feed}</span>
                    <button
                      type="button"
                      onClick={() => updateFeeds(removeCustomRssFeed(settings.customRssFeeds, feed))}
                      className={`inline-flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-bold uppercase tracking-widest transition-colors ${
                        isDarkMode
                          ? "border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                          : "border-zinc-300 bg-zinc-150 text-zinc-700 hover:bg-zinc-200"
                      }`}
                    >
                      <Trash2 size={12} /> Delete
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}