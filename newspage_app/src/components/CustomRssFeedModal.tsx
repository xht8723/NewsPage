import type React from "react";
import { useEffect, useState } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import type { CustomRssFeed, UserSettings } from "../types/news";
import { addCustomRssFeed, normalizeRssFeedUrl, removeCustomRssFeed, updateCustomRssFeed } from "../utils/rssSettings";

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
  const [draftName, setDraftName] = useState("");
  const [draftFeed, setDraftFeed] = useState("");
  const [editingUrl, setEditingUrl] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingFeedUrl, setEditingFeedUrl] = useState("");
  const canAddFeed = draftName.trim().length > 0 && normalizeRssFeedUrl(draftFeed).length > 0;
  const canSaveEdit = editingName.trim().length > 0 && normalizeRssFeedUrl(editingFeedUrl).length > 0;

  useEffect(() => {
    if (show) {
      setDraftName("");
      setDraftFeed("");
      setEditingUrl(null);
      setEditingName("");
      setEditingFeedUrl("");
    }
  }, [show]);

  if (!show) {
    return null;
  }

  const updateFeeds = (nextFeeds: UserSettings["customRssFeeds"]) => {
    setSettings((current) => ({ ...current, customRssFeeds: nextFeeds }));
    saveSetting("customRssFeeds", JSON.stringify(nextFeeds));
  };

  const addFeed = () => {
    const nextFeeds = addCustomRssFeed(settings.customRssFeeds, {
      name: draftName,
      url: draftFeed,
    });
    if (nextFeeds === settings.customRssFeeds) {
      return;
    }

    updateFeeds(nextFeeds);
    setDraftName("");
    setDraftFeed("");
  };

  const startEditingFeed = (feed: CustomRssFeed) => {
    setEditingUrl(feed.url);
    setEditingName(feed.name);
    setEditingFeedUrl(feed.url);
  };

  const stopEditingFeed = () => {
    setEditingUrl(null);
    setEditingName("");
    setEditingFeedUrl("");
  };

  const saveEditedFeed = () => {
    if (!editingUrl) {
      return;
    }

    const nextFeeds = updateCustomRssFeed(settings.customRssFeeds, editingUrl, {
      name: editingName,
      url: editingFeedUrl,
    });
    if (nextFeeds === settings.customRssFeeds) {
      return;
    }

    updateFeeds(nextFeeds);
    stopEditingFeed();
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
          <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)_auto]">
            <input
              type="text"
              placeholder="Feed name"
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
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
              disabled={!canAddFeed}
              className={`inline-flex items-center justify-center gap-1 rounded-lg border px-3 py-2 text-xs font-bold uppercase tracking-widest transition-colors ${
                isDarkMode
                  ? "border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                  : "border-zinc-300 bg-zinc-200 text-zinc-700 hover:bg-zinc-300"
              } disabled:cursor-not-allowed disabled:opacity-50`}
            >
              <Plus size={12} /> Add Feed
            </button>
          </div>
          <p className={`text-xs ${isDarkMode ? "text-zinc-500" : "text-zinc-500"}`}>
            Each custom RSS feed needs a display name and a feed URL.
          </p>

          <div className={`overflow-hidden rounded-xl border ${isDarkMode ? "border-zinc-800" : "border-zinc-200"}`}>
            {settings.customRssFeeds.length === 0 ? (
              <p className={`p-4 text-sm ${isDarkMode ? "text-zinc-500" : "text-zinc-500"}`}>
                No custom RSS feeds saved yet.
              </p>
            ) : (
              <div className="divide-y divide-zinc-800/20">
                {settings.customRssFeeds.map((feed) => (
                  <div key={feed.url} className="flex items-center justify-between gap-3 px-4 py-3">
                    {editingUrl === feed.url ? (
                      <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
                        <input
                          type="text"
                          value={editingName}
                          onChange={(event) => setEditingName(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              saveEditedFeed();
                            }
                            if (event.key === "Escape") {
                              event.preventDefault();
                              stopEditingFeed();
                            }
                          }}
                          className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none ${
                            isDarkMode
                              ? "border-zinc-700 bg-zinc-800 text-zinc-100"
                              : "border-zinc-300 bg-zinc-200 text-zinc-900"
                          }`}
                        />
                        <input
                          type="text"
                          value={editingFeedUrl}
                          onChange={(event) => setEditingFeedUrl(event.target.value)}
                          onBlur={() => setEditingFeedUrl((current) => normalizeRssFeedUrl(current))}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              saveEditedFeed();
                            }
                            if (event.key === "Escape") {
                              event.preventDefault();
                              stopEditingFeed();
                            }
                          }}
                          className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none ${
                            isDarkMode
                              ? "border-zinc-700 bg-zinc-800 text-zinc-100"
                              : "border-zinc-300 bg-zinc-200 text-zinc-900"
                          }`}
                        />
                      </div>
                    ) : (
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{feed.name}</p>
                        <p className={`break-all text-xs ${isDarkMode ? "text-zinc-500" : "text-zinc-500"}`}>{feed.url}</p>
                      </div>
                    )}
                    <div className="flex shrink-0 items-center gap-2">
                      {editingUrl === feed.url ? (
                        <>
                          <button
                            type="button"
                            onClick={saveEditedFeed}
                            disabled={!canSaveEdit}
                            className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-bold uppercase tracking-widest transition-colors ${
                              isDarkMode
                                ? "border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                                : "border-zinc-300 bg-zinc-150 text-zinc-700 hover:bg-zinc-200"
                            } disabled:cursor-not-allowed disabled:opacity-50`}
                          >
                            <Check size={12} /> Save
                          </button>
                          <button
                            type="button"
                            onClick={stopEditingFeed}
                            className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-bold uppercase tracking-widest transition-colors ${
                              isDarkMode
                                ? "border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                                : "border-zinc-300 bg-zinc-150 text-zinc-700 hover:bg-zinc-200"
                            }`}
                          >
                            <X size={12} /> Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => startEditingFeed(feed)}
                            className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-bold uppercase tracking-widest transition-colors ${
                              isDarkMode
                                ? "border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                                : "border-zinc-300 bg-zinc-150 text-zinc-700 hover:bg-zinc-200"
                            }`}
                          >
                            <Pencil size={12} /> Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => updateFeeds(removeCustomRssFeed(settings.customRssFeeds, feed.url))}
                            className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-bold uppercase tracking-widest transition-colors ${
                              isDarkMode
                                ? "border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                                : "border-zinc-300 bg-zinc-150 text-zinc-700 hover:bg-zinc-200"
                            }`}
                          >
                            <Trash2 size={12} /> Delete
                          </button>
                        </>
                      )}
                    </div>
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