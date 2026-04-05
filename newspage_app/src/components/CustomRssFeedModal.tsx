import type React from "react";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Check, Pencil, Plus, Rss, Trash2, X } from "lucide-react";
import { NeonCheckbox } from "./NeonCheckbox";
import type { FeedSource } from "../types/news";
import { normalizeRssFeedUrl } from "../utils/rssSettings";
import { usePanelTransition } from "../hooks/usePanelTransition";

interface CustomRssFeedModalProps {
  show: boolean;
  isDarkMode: boolean;
  feedSources: FeedSource[];
  onRefresh: () => Promise<void>;
  onClose: () => void;
}

export function CustomRssFeedModal({
  show,
  isDarkMode,
  feedSources,
  onRefresh,
  onClose,
}: CustomRssFeedModalProps): React.JSX.Element | null {
  const [draftName, setDraftName] = useState("");
  const [draftFeed, setDraftFeed] = useState("");
  const [editingUrl, setEditingUrl] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingFeedUrl, setEditingFeedUrl] = useState("");
  const [saving, setSaving] = useState(false);

  const DEFAULT_SOURCE_TYPES = ["ann", "automaton", "gcores", "yys"];
  const customFeeds = feedSources.filter((s) =>
    ["ann", "automaton", "gcores", "yys", "custom_rss"].includes(s.source_type),
  );
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

  const { isMounted, isClosing } = usePanelTransition(show, 170);

  if (!isMounted) {
    return null;
  }

  const addFeed = async () => {
    const name = draftName.trim();
    const url = normalizeRssFeedUrl(draftFeed);
    if (!name || !url) return;
    if (customFeeds.some((s) => s.source_ref === url)) return;
    setSaving(true);
    try {
      await invoke("upsert_feed_source_action", {
        request: { source_type: "custom_rss", source_ref: url, display_name: name, enabled: true },
      });
      await onRefresh();
      setDraftName("");
      setDraftFeed("");
    } catch (error) {
      console.warn("Failed to add custom RSS feed", error);
    } finally {
      setSaving(false);
    }
  };

  const startEditingFeed = (source: FeedSource) => {
    setEditingUrl(source.source_ref);
    setEditingName(source.display_name);
    setEditingFeedUrl(source.source_ref);
  };

  const stopEditingFeed = () => {
    setEditingUrl(null);
    setEditingName("");
    setEditingFeedUrl("");
  };

  const toggleFeedEnabled = async (source: FeedSource) => {
    setSaving(true);
    try {
      await invoke("upsert_feed_source_action", {
        request: { source_type: source.source_type, source_ref: source.source_ref, display_name: source.display_name, enabled: !source.enabled },
      });
      await onRefresh();
    } catch (error) {
      console.warn("Failed to toggle feed", error);
    } finally {
      setSaving(false);
    }
  };

  const saveEditedFeed = async (source: FeedSource) => {
    const newName = editingName.trim();
    const newUrl = normalizeRssFeedUrl(editingFeedUrl);
    if (!newName || !newUrl) return;
    setSaving(true);
    try {
      if (source.source_ref !== newUrl) {
        await invoke("remove_feed_source_action", {
          request: { source_type: source.source_type, source_ref: source.source_ref },
        });
        await invoke("upsert_feed_source_action", {
          request: { source_type: source.source_type, source_ref: newUrl, display_name: newName, enabled: source.enabled },
        });
      } else {
        await invoke("upsert_feed_source_action", {
          request: { source_type: source.source_type, source_ref: source.source_ref, display_name: newName, enabled: source.enabled },
        });
      }
      await onRefresh();
      stopEditingFeed();
    } catch (error) {
      console.warn("Failed to save edited feed", error);
    } finally {
      setSaving(false);
    }
  };

  const deleteFeed = async (source: FeedSource) => {
    setSaving(true);
    try {
      await invoke("remove_feed_source_action", {
        request: { source_type: source.source_type, source_ref: source.source_ref },
      });
      await onRefresh();
    } catch (error) {
      console.warn("Failed to delete custom RSS feed", error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`${isClosing ? "popup-overlay-out" : "popup-overlay"} fixed inset-0 z-[120] flex items-center justify-center p-4`}>
      <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={onClose} />
      <div
        className={`${isClosing ? "popup-panel-out" : "popup-panel"} relative w-full max-w-2xl overflow-hidden rounded-3xl border shadow-2xl ${
          isDarkMode ? "border-zinc-800 bg-zinc-900 text-zinc-300" : "border-zinc-200 bg-zinc-150 text-zinc-800"
        }`}
      >
        <div
          className={`flex items-center justify-between border-b p-5 ${
            isDarkMode ? "border-zinc-800 bg-zinc-950/50" : "border-zinc-200 bg-zinc-150"
          }`}
        >
          <div className="flex items-center gap-2">
            <Rss size={18} className="text-zinc-500" />
            <h3 className="text-base font-bold uppercase tracking-widest">Custom RSS Feed</h3>
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
                  void addFeed();
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
                  void addFeed();
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
              onClick={() => void addFeed()}
              disabled={!canAddFeed || saving}
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
            {customFeeds.length === 0 ? (
              <p className={`p-4 text-sm ${isDarkMode ? "text-zinc-500" : "text-zinc-500"}`}>
                No custom RSS feeds saved yet.
              </p>
            ) : (
              <div className="divide-y divide-zinc-800/20">
                {customFeeds.map((source) => (
                  <div key={source.source_ref} className="flex items-center justify-between gap-3 px-4 py-3">
                    {editingUrl === source.source_ref ? (
                      <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
                        <input
                          type="text"
                          value={editingName}
                          onChange={(event) => setEditingName(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void saveEditedFeed(source);
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
                              void saveEditedFeed(source);
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
                        <p className="truncate text-sm font-semibold">{source.display_name}</p>
                        <p className={`break-all text-xs ${isDarkMode ? "text-zinc-500" : "text-zinc-500"}`}>{source.source_ref}</p>
                      </div>
                    )}
                    <div className="flex shrink-0 items-center gap-2">
                      {editingUrl === source.source_ref ? (
                        <>
                          <button
                            type="button"
                            onClick={() => void saveEditedFeed(source)}
                            disabled={!canSaveEdit || saving}
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
                      ) : DEFAULT_SOURCE_TYPES.includes(source.source_type) ? (
                        <NeonCheckbox
                          checked={source.enabled}
                          onChange={() => void toggleFeedEnabled(source)}
                          isDarkMode={isDarkMode}
                          ariaLabel={`Toggle ${source.display_name}`}
                          disabled={saving}
                        />
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => startEditingFeed(source)}
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
                            onClick={() => void deleteFeed(source)}
                            disabled={saving}
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
