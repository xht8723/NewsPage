import type React from "react";
import { useEffect, useRef, useState } from "react";
import { Check, Pencil, Plus, Rss, Trash2, X } from "lucide-react";
import { NeonCheckbox } from "./NeonCheckbox";
import type { FeedSource } from "../types/article";
import { normalizeRssFeedUrl } from "../utils/rssSettings";
import { usePanelTransition } from "../hooks/usePanelTransition";
import { TAG_COLOR_PRESETS } from "../utils/articleMeta";
import { feedService } from "../services/feedService";

interface CustomRssFeedModalProps {
  show: boolean;
  isDarkMode: boolean;
  feedSources: FeedSource[];
  onRefresh: () => Promise<void>;
  onClose: () => void;
}

// ─── Inline color picker ──────────────────────────────────────────────────────

interface ColorPickerProps {
  value: string;           // current hex, or "" for no custom color
  isDarkMode: boolean;
  disabled?: boolean;
  onChange: (hex: string) => void;
}

function ColorPicker({ value, isDarkMode, disabled, onChange }: ColorPickerProps): React.JSX.Element {
  const hexInputRef = useRef<HTMLInputElement>(null);

  // Determine if the current value matches a preset exactly
  const activePreset = TAG_COLOR_PRESETS.find((p) => p.hex.toLowerCase() === value.toLowerCase());
  // A "custom" hex is any non-empty value that isn't a preset
  const isCustomHex = value.trim() !== "" && !activePreset;

  const inputBase = `rounded border px-2 py-1 text-xs font-mono focus:outline-none w-[88px] ${
    isDarkMode
      ? "border-zinc-700 bg-zinc-800 text-zinc-100 placeholder-zinc-600"
      : "border-zinc-300 bg-zinc-200 text-zinc-900 placeholder-zinc-500"
  }`;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {/* Preset swatches */}
      {TAG_COLOR_PRESETS.map((preset) => (
        <button
          key={preset.hex}
          type="button"
          title={preset.label}
          disabled={disabled}
          onClick={() => onChange(value.toLowerCase() === preset.hex.toLowerCase() ? "" : preset.hex)}
          className="relative h-5 w-5 flex-shrink-0 rounded-full transition-transform hover:scale-110 disabled:cursor-not-allowed disabled:opacity-50"
          style={{ backgroundColor: preset.hex }}
        >
          {value.toLowerCase() === preset.hex.toLowerCase() && (
            <span className="absolute inset-0 flex items-center justify-center">
              <Check size={10} className="text-white drop-shadow" />
            </span>
          )}
        </button>
      ))}
      {/* Custom hex input + color picker button */}
      <div className="relative flex items-center gap-1">
        <input
          type="text"
          placeholder="#rrggbb"
          disabled={disabled}
          value={isCustomHex ? value : ""}
          onChange={(e) => {
            const v = e.target.value.trim();
            if (v === "" || /^#[0-9a-fA-F]{0,6}$/.test(v)) {
              onChange(v);
            }
          }}
          className={`${inputBase}${isCustomHex ? " ring-1 ring-inset ring-white/30" : ""}`}
        />
        {/* Native color picker trigger */}
        <input
          ref={hexInputRef}
          type="color"
          disabled={disabled}
          value={value.trim() !== "" ? value : "#71717a"}
          onChange={(e) => onChange(e.target.value)}
          className="sr-only"
          aria-label="Pick custom color"
        />
        <button
          type="button"
          disabled={disabled}
          title="Pick custom color"
          onClick={() => hexInputRef.current?.click()}
          className={`h-5 w-5 flex-shrink-0 rounded-full border-2 transition-transform hover:scale-110 disabled:cursor-not-allowed disabled:opacity-50 ${
            isDarkMode ? "border-zinc-600" : "border-zinc-400"
          }`}
          style={{ background: "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)" }}
        />
      </div>
    </div>
  );
}

// ─── Main modal ───────────────────────────────────────────────────────────────

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
  const [colorPickerOpen, setColorPickerOpen] = useState<string | null>(null);

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
      await feedService.upsertSource({
        source_type: "custom_rss", source_ref: url, display_name: name, enabled: true, tag_color: "",
      });
      await onRefresh();
      setDraftName("");
      setDraftFeed("");
    } catch (_error) {
    } finally {
      setSaving(false);
    }
  };

  const startEditingFeed = (source: FeedSource) => {
    setEditingUrl(source.source_ref);
    setEditingName(source.display_name);
    setEditingFeedUrl(source.source_ref);
    setColorPickerOpen(null);
  };

  const stopEditingFeed = () => {
    setEditingUrl(null);
    setEditingName("");
    setEditingFeedUrl("");
  };

  const toggleFeedEnabled = async (source: FeedSource) => {
    setSaving(true);
    try {
      await feedService.upsertSource({
        source_type: source.source_type, source_ref: source.source_ref, display_name: source.display_name, enabled: !source.enabled, tag_color: source.tag_color,
      });
      await onRefresh();
    } catch (_error) {
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
        await feedService.removeSource({
          source_type: source.source_type, source_ref: source.source_ref,
        });
        await feedService.upsertSource({
          source_type: source.source_type, source_ref: newUrl, display_name: newName, enabled: source.enabled, tag_color: source.tag_color,
        });
      } else {
        await feedService.upsertSource({
          source_type: source.source_type, source_ref: source.source_ref, display_name: newName, enabled: source.enabled, tag_color: source.tag_color,
        });
      }
      await onRefresh();
      stopEditingFeed();
    } catch (_error) {
    } finally {
      setSaving(false);
    }
  };

  const deleteFeed = async (source: FeedSource) => {
    setSaving(true);
    try {
      await feedService.removeSource({
        source_type: source.source_type, source_ref: source.source_ref,
      });
      await onRefresh();
    } catch (_error) {
    } finally {
      setSaving(false);
    }
  };

  const setTagColor = async (source: FeedSource, color: string) => {
    // Validate: accept empty string or valid 6-digit hex
    const normalized = color.trim();
    if (normalized !== "" && !/^#[0-9a-fA-F]{6}$/.test(normalized)) return;
    try {
      await feedService.upsertSource({
        source_type: source.source_type, source_ref: source.source_ref, display_name: source.display_name, enabled: source.enabled, tag_color: normalized,
      });
      await onRefresh();
    } catch (_error) {
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
                  <div key={source.source_ref} className="flex flex-col px-4 py-3">
                    {/* Top row: name/url info + controls */}
                    <div className="flex items-center justify-between gap-3">
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
                          <div className="flex items-center gap-2">
                            {source.tag_color && (
                              <span
                                className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full"
                                style={{ backgroundColor: source.tag_color }}
                              />
                            )}
                            <p className="truncate text-sm font-semibold">{source.display_name}</p>
                          </div>
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
                        ) : (
                          <>
                            {/* Tag color button — always shown when not in edit mode */}
                            <button
                              type="button"
                              title="Tag color"
                              disabled={saving}
                              onClick={() => setColorPickerOpen(colorPickerOpen === source.source_ref ? null : source.source_ref)}
                              className={`h-5 w-5 flex-shrink-0 rounded-full border-2 transition-transform hover:scale-110 disabled:cursor-not-allowed disabled:opacity-50 ${
                                colorPickerOpen === source.source_ref
                                  ? isDarkMode ? "border-zinc-300" : "border-zinc-700"
                                  : isDarkMode ? "border-zinc-600" : "border-zinc-400"
                              }`}
                              style={{ background: "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)" }}
                            />
                            {DEFAULT_SOURCE_TYPES.includes(source.source_type) ? (
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
                          </>
                        )}
                      </div>
                    </div>

                    {/* Color picker panel — inline expansion, only for the open source */}
                    {colorPickerOpen === source.source_ref && editingUrl !== source.source_ref && (
                      <div className={`mt-2 rounded-lg border p-3 ${isDarkMode ? "border-zinc-700 bg-zinc-800/60" : "border-zinc-200 bg-zinc-100"}`}>
                        <div className="flex flex-wrap items-center gap-3">
                          <ColorPicker
                            value={source.tag_color}
                            isDarkMode={isDarkMode}
                            disabled={saving}
                            onChange={(hex) => void setTagColor(source, hex)}
                          />
                          {source.tag_color && (
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => void setTagColor(source, "")}
                              className={`text-[10px] font-bold uppercase tracking-widest opacity-50 hover:opacity-100 disabled:cursor-not-allowed ${isDarkMode ? "text-zinc-400" : "text-zinc-600"}`}
                            >
                              Reset
                            </button>
                          )}
                        </div>
                      </div>
                    )}
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
