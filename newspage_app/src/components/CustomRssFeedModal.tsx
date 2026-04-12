import type React from "react";
import { useEffect, useRef, useState } from "react";
import { Check, FileCode, Pencil, Plus, Rss, Sparkles, Trash2, X } from "lucide-react";
import { NeonCheckbox } from "./NeonCheckbox";
import type { BackendArticle, FeedSource } from "../types/article";
import { normalizeRssFeedUrl } from "../utils/rssSettings";
import { usePanelTransition } from "../hooks/usePanelTransition";
import { TAG_COLOR_PRESETS } from "../utils/articleMeta";
import { feedService } from "../services/feedService";
import { useSettingsStore } from "../stores/settingsStore";
import { getSelectedModel, getSelectedApiKey, getSelectedEndpoint } from "../utils/llmConfig";

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

const DEFAULT_SOURCE_TYPES = ["ann", "automaton", "gcores", "yys"];

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
  const [showHtmlToRss, setShowHtmlToRss] = useState(false);
  const [htmlToRssUrl, setHtmlToRssUrl] = useState("");
  const [htmlToRssName, setHtmlToRssName] = useState("");
  const [htmlToRssContainerSelector, setHtmlToRssContainerSelector] = useState("");
  const [htmlToRssTitleSelector, setHtmlToRssTitleSelector] = useState("");
  const [htmlToRssLinkSelector, setHtmlToRssLinkSelector] = useState("");
  const [htmlToRssDateSelector, setHtmlToRssDateSelector] = useState("");
  const [htmlToRssThumbnailSelector, setHtmlToRssThumbnailSelector] = useState("");
  const [htmlToRssSnippetSelector, setHtmlToRssSnippetSelector] = useState("");
  const [htmlToRssAuthorSelector, setHtmlToRssAuthorSelector] = useState("");
  const [htmlToRssLoading, setHtmlToRssLoading] = useState(false);
  const [htmlToRssAiLoading, setHtmlToRssAiLoading] = useState(false);
  const [htmlToRssAiError, setHtmlToRssAiError] = useState("");
  const [showHtmlToRssPreview, setShowHtmlToRssPreview] = useState(false);
  const [htmlToRssPreviewArticles, setHtmlToRssPreviewArticles] = useState<BackendArticle[]>([]);
  const [htmlToRssPreviewError, setHtmlToRssPreviewError] = useState("");
  const [htmlToRssSaving, setHtmlToRssSaving] = useState(false);

  const settings = useSettingsStore((s) => s.settings);

  const inputCls = `w-full rounded-lg border px-3 py-2 text-sm focus:outline-none ${
    isDarkMode
      ? "border-zinc-700 bg-zinc-800 text-zinc-100 placeholder-zinc-600"
      : "border-zinc-300 bg-zinc-200 text-zinc-900 placeholder-zinc-500"
  }`;

  const customFeeds = feedSources.filter((s) =>
    ["ann", "automaton", "gcores", "yys", "custom_rss", "html_to_rss"].includes(s.source_type),
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
      setShowHtmlToRss(false);
      setHtmlToRssUrl("");
      setHtmlToRssName("");
      setHtmlToRssContainerSelector("");
      setHtmlToRssTitleSelector("");
      setHtmlToRssLinkSelector("");
      setHtmlToRssDateSelector("");
      setHtmlToRssThumbnailSelector("");
      setHtmlToRssSnippetSelector("");
      setHtmlToRssAuthorSelector("");
      setHtmlToRssAiError("");
      setShowHtmlToRssPreview(false);
      setHtmlToRssPreviewArticles([]);
      setHtmlToRssPreviewError("");
      setHtmlToRssSaving(false);
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
              className={inputCls}
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
              className={inputCls}
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
          <button
            type="button"
            onClick={() => setShowHtmlToRss(true)}
            className={`inline-flex items-center justify-center gap-1 rounded-lg border px-3 py-2 text-xs font-bold uppercase tracking-widest transition-colors ${
              isDarkMode
                ? "border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                : "border-zinc-300 bg-zinc-200 text-zinc-700 hover:bg-zinc-300"
            }`}
          >
            <FileCode size={12} /> HTML to RSS
          </button>
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
                            onChange={source.source_type === "html_to_rss" ? undefined : (event) => setEditingFeedUrl(event.target.value)}
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

      {showHtmlToRss && (
        <div className="popup-overlay fixed inset-0 z-[130] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={() => setShowHtmlToRss(false)} />
          <div
            className={`relative w-full max-w-4xl overflow-hidden rounded-3xl border shadow-2xl ${
              isDarkMode ? "border-zinc-800 bg-zinc-900 text-zinc-300" : "border-zinc-200 bg-zinc-150 text-zinc-800"
            }`}
          >
            <div
              className={`flex items-center justify-between border-b p-5 ${
                isDarkMode ? "border-zinc-800 bg-zinc-950/50" : "border-zinc-200 bg-zinc-150"
              }`}
            >
              <div className="flex items-center gap-2">
                <FileCode size={18} className="text-zinc-500" />
                <h3 className="text-base font-bold uppercase tracking-widest">HTML to RSS</h3>
              </div>
              <button type="button" onClick={() => setShowHtmlToRss(false)} className="hover:opacity-60" aria-label="Close HTML to RSS">
                <X size={18} />
              </button>
            </div>

            <div className={`max-h-[calc(100vh-12rem)] space-y-4 overflow-y-auto p-5 news-scroll ${isDarkMode ? "news-scroll-dark" : "news-scroll-light"}`}>
              <div>
                <label className="mb-1 block text-sm font-semibold">Source Name <span className="text-red-400 font-normal text-xs">(required)</span></label>
                <p className={`mb-1.5 text-xs ${isDarkMode ? "text-zinc-500" : "text-zinc-500"}`}>
                  A display name for this feed source.
                </p>
                <input
                  type="text"
                  placeholder="My News Site"
                  value={htmlToRssName}
                  onChange={(e) => setHtmlToRssName(e.target.value)}
                  className={inputCls}
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-semibold">URL <span className="text-red-400 font-normal text-xs">(required)</span></label>
                <p className={`mb-1.5 text-xs ${isDarkMode ? "text-zinc-500" : "text-zinc-500"}`}>
                  The webpage to scrape for article links.
                </p>
                <input
                  type="text"
                  placeholder="https://example.com/news"
                  value={htmlToRssUrl}
                  onChange={(e) => setHtmlToRssUrl(e.target.value)}
                  className={inputCls}
                />
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={htmlToRssAiLoading || !htmlToRssUrl.trim() || !htmlToRssName.trim()}
                    onClick={() => {
                      if (htmlToRssAiLoading) return;
                      setHtmlToRssAiLoading(true);
      setHtmlToRssAiError("");
      setShowHtmlToRssPreview(false);
      setHtmlToRssPreviewArticles([]);
      setHtmlToRssPreviewError("");
                      feedService
                        .suggestHtmlToRssSelectors({
                          url: htmlToRssUrl.trim(),
                          provider: settings.llmProvider,
                          model: getSelectedModel(settings),
                          api_key: getSelectedApiKey(settings).trim() || null,
                          endpoint: getSelectedEndpoint(settings).trim() || null,
                        })
                        .then((result) => {
                          setHtmlToRssContainerSelector(result.container_selector);
                          setHtmlToRssTitleSelector(result.title_selector);
                          setHtmlToRssLinkSelector(result.link_selector);
                          setHtmlToRssDateSelector(result.date_selector);
                          setHtmlToRssThumbnailSelector(result.thumbnail_selector);
                          setHtmlToRssSnippetSelector(result.snippet_selector);
                          setHtmlToRssAuthorSelector(result.author_selector);
                        })
                        .catch((err) => {
                          setHtmlToRssAiError(String(err));
                        })
                        .finally(() => setHtmlToRssAiLoading(false));
                    }}
                    className={`inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-bold uppercase tracking-widest transition-colors ${
                      isDarkMode
                        ? "border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                        : "border-zinc-300 bg-zinc-200 text-zinc-700 hover:bg-zinc-300"
                    } disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    <Sparkles size={12} /> {htmlToRssAiLoading ? "Analyzing..." : "Use AI"}
                  </button>
                  <span className={`text-xs ${isDarkMode ? "text-zinc-500" : "text-zinc-500"}`}>
                    {htmlToRssAiLoading
                      ? `Fetching page and analyzing with ${settings.llmProvider}...`
                      : "Auto-fill all selectors below by letting AI analyze the page structure."}
                  </span>
                </div>
                {htmlToRssAiError && (
                  <p className="mt-1.5 text-xs text-red-400">{htmlToRssAiError}</p>
                )}
              </div>

              <div>
                <label className="mb-1 block text-sm font-semibold">Container CSS Selector <span className="text-red-400 font-normal text-xs">(required)</span></label>
                <p className={`mb-1.5 text-xs ${isDarkMode ? "text-zinc-500" : "text-zinc-500"}`}>
                  CSS selector matching each repeating article block on the page. Each matched element is treated as one article.
                </p>
                <input
                  type="text"
                  placeholder="table tbody tr, article, div.news-item"
                  value={htmlToRssContainerSelector}
                  onChange={(e) => setHtmlToRssContainerSelector(e.target.value)}
                  className={`w-full rounded-lg border px-3 py-2 font-mono text-sm focus:outline-none ${
                    isDarkMode
                      ? "border-zinc-700 bg-zinc-800 text-zinc-100 placeholder-zinc-600"
                      : "border-zinc-300 bg-zinc-200 text-zinc-900 placeholder-zinc-500"
                  }`}
                />
              </div>

              <div className="grid grid-cols-1 gap-x-4 gap-y-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-semibold">Title CSS Selector <span className="text-red-400 font-normal text-xs">(required)</span></label>
                  <p className={`mb-1.5 text-xs ${isDarkMode ? "text-zinc-500" : "text-zinc-500"}`}>
                    CSS selector matching the article title element. The inner text will be used as the title.
                  </p>
                  <input
                    type="text"
                    placeholder="h2.article-title"
                    value={htmlToRssTitleSelector}
                    onChange={(e) => setHtmlToRssTitleSelector(e.target.value)}
                    className={`w-full rounded-lg border px-3 py-2 font-mono text-sm focus:outline-none ${
                      isDarkMode
                        ? "border-zinc-700 bg-zinc-800 text-zinc-100 placeholder-zinc-600"
                        : "border-zinc-300 bg-zinc-200 text-zinc-900 placeholder-zinc-500"
                    }`}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-semibold">Link CSS Selector <span className="text-red-400 font-normal text-xs">(required)</span></label>
                  <p className={`mb-1.5 text-xs ${isDarkMode ? "text-zinc-500" : "text-zinc-500"}`}>
                    CSS selector matching the anchor (&lt;a&gt;) element. The href attribute will be used as the article link.
                  </p>
                  <input
                    type="text"
                    placeholder="h2.article-title a"
                    value={htmlToRssLinkSelector}
                    onChange={(e) => setHtmlToRssLinkSelector(e.target.value)}
                    className={`w-full rounded-lg border px-3 py-2 font-mono text-sm focus:outline-none ${
                      isDarkMode
                        ? "border-zinc-700 bg-zinc-800 text-zinc-100 placeholder-zinc-600"
                        : "border-zinc-300 bg-zinc-200 text-zinc-900 placeholder-zinc-500"
                    }`}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-semibold">PubDate CSS Selector <span className="text-zinc-500 font-normal text-xs">(optional)</span></label>
                  <p className={`mb-1.5 text-xs ${isDarkMode ? "text-zinc-500" : "text-zinc-500"}`}>
                    CSS selector matching the publication date element. The inner text or datetime attribute will be parsed as the date.
                  </p>
                  <input
                    type="text"
                    placeholder="time.pub-date, span.date"
                    value={htmlToRssDateSelector}
                    onChange={(e) => setHtmlToRssDateSelector(e.target.value)}
                    className={`w-full rounded-lg border px-3 py-2 font-mono text-sm focus:outline-none ${
                      isDarkMode
                        ? "border-zinc-700 bg-zinc-800 text-zinc-100 placeholder-zinc-600"
                        : "border-zinc-300 bg-zinc-200 text-zinc-900 placeholder-zinc-500"
                    }`}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-semibold">Thumbnail CSS Selector <span className="text-zinc-500 font-normal text-xs">(optional)</span></label>
                  <p className={`mb-1.5 text-xs ${isDarkMode ? "text-zinc-500" : "text-zinc-500"}`}>
                    CSS selector matching a thumbnail image element. The <code>src</code> attribute will be used as the thumbnail URL.
                  </p>
                  <input
                    type="text"
                    placeholder="img.article-thumb"
                    value={htmlToRssThumbnailSelector}
                    onChange={(e) => setHtmlToRssThumbnailSelector(e.target.value)}
                    className={`w-full rounded-lg border px-3 py-2 font-mono text-sm focus:outline-none ${
                      isDarkMode
                        ? "border-zinc-700 bg-zinc-800 text-zinc-100 placeholder-zinc-600"
                        : "border-zinc-300 bg-zinc-200 text-zinc-900 placeholder-zinc-500"
                    }`}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-semibold">Snippet CSS Selector <span className="text-zinc-500 font-normal text-xs">(optional)</span></label>
                  <p className={`mb-1.5 text-xs ${isDarkMode ? "text-zinc-500" : "text-zinc-500"}`}>
                    CSS selector matching a summary or description element. The inner text will be used as the article snippet.
                  </p>
                  <input
                    type="text"
                    placeholder="p.article-summary"
                    value={htmlToRssSnippetSelector}
                    onChange={(e) => setHtmlToRssSnippetSelector(e.target.value)}
                    className={`w-full rounded-lg border px-3 py-2 font-mono text-sm focus:outline-none ${
                      isDarkMode
                        ? "border-zinc-700 bg-zinc-800 text-zinc-100 placeholder-zinc-600"
                        : "border-zinc-300 bg-zinc-200 text-zinc-900 placeholder-zinc-500"
                    }`}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-semibold">Author CSS Selector <span className="text-zinc-500 font-normal text-xs">(optional)</span></label>
                  <p className={`mb-1.5 text-xs ${isDarkMode ? "text-zinc-500" : "text-zinc-500"}`}>
                    CSS selector matching the author element. The inner text will be used as the article author. Leave blank if not available.
                  </p>
                  <input
                    type="text"
                    placeholder="span.author-name"
                    value={htmlToRssAuthorSelector}
                    onChange={(e) => setHtmlToRssAuthorSelector(e.target.value)}
                    className={`w-full rounded-lg border px-3 py-2 font-mono text-sm focus:outline-none ${
                      isDarkMode
                        ? "border-zinc-700 bg-zinc-800 text-zinc-100 placeholder-zinc-600"
                        : "border-zinc-300 bg-zinc-200 text-zinc-900 placeholder-zinc-500"
                    }`}
                  />
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  disabled={htmlToRssLoading || !htmlToRssUrl.trim() || !htmlToRssContainerSelector.trim() || !htmlToRssTitleSelector.trim() || !htmlToRssLinkSelector.trim()}
                  onClick={() => {
                    if (htmlToRssLoading) return;
                    setHtmlToRssLoading(true);
                    setHtmlToRssPreviewError("");
                    setHtmlToRssPreviewArticles([]);
                    feedService
                      .testHtmlToRss({
                        url: htmlToRssUrl.trim(),
                        display_name: htmlToRssName.trim() || "HTML2RSS",
                        container_selector: htmlToRssContainerSelector.trim(),
                        title_selector: htmlToRssTitleSelector.trim(),
                        link_selector: htmlToRssLinkSelector.trim(),
                        date_selector: htmlToRssDateSelector.trim(),
                        thumbnail_selector: htmlToRssThumbnailSelector.trim(),
                        snippet_selector: htmlToRssSnippetSelector.trim(),
                        author_selector: htmlToRssAuthorSelector.trim(),
                      })
                      .then((articles) => {
                        setHtmlToRssPreviewArticles(articles);
                      })
                      .catch((err) => {
                        setHtmlToRssPreviewError(String(err));
                      })
                      .finally(() => {
                        setHtmlToRssLoading(false);
                        setShowHtmlToRssPreview(true);
                      });
                  }}
                  className={`inline-flex items-center gap-1 rounded-lg border px-4 py-2 text-xs font-bold uppercase tracking-widest transition-colors ${
                    isDarkMode
                      ? "border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                      : "border-zinc-300 bg-zinc-200 text-zinc-700 hover:bg-zinc-300"
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  <Check size={12} /> {htmlToRssLoading ? "Scraping..." : "Confirm"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showHtmlToRssPreview && (
        <div className="popup-overlay fixed inset-0 z-[140] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={() => setShowHtmlToRssPreview(false)} />
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
              <div className="flex items-center gap-2">
                <FileCode size={18} className="text-zinc-500" />
                <h3 className="text-base font-bold uppercase tracking-widest">Scrape Result</h3>
                {!htmlToRssPreviewError && (
                  <span className={`text-xs ${isDarkMode ? "text-zinc-500" : "text-zinc-500"}`}>
                    {htmlToRssPreviewArticles.length} article{htmlToRssPreviewArticles.length !== 1 ? "s" : ""} found
                  </span>
                )}
              </div>
              <button type="button" onClick={() => setShowHtmlToRssPreview(false)} className="hover:opacity-60" aria-label="Close preview">
                <X size={18} />
              </button>
            </div>

            <div className={`max-h-[calc(100vh-16rem)] overflow-y-auto p-5 news-scroll ${isDarkMode ? "news-scroll-dark" : "news-scroll-light"}`}>
              {htmlToRssPreviewError ? (
                <p className="text-sm text-red-400">{htmlToRssPreviewError}</p>
              ) : (
                <>
                  <p className={`mb-3 text-sm ${isDarkMode ? "text-zinc-400" : "text-zinc-600"}`}>
                    Are these results correct?
                  </p>
                  <div className="space-y-2">
                    {htmlToRssPreviewArticles.slice(0, 10).map((article) => (
                      <div
                        key={article.id}
                        className={`flex gap-3 rounded-lg border p-3 ${
                          isDarkMode ? "border-zinc-800 bg-zinc-800/40" : "border-zinc-200 bg-zinc-100/60"
                        }`}
                      >
                        {article.thumbnail && (
                          <img
                            src={article.thumbnail}
                            alt=""
                            className="h-10 w-10 flex-shrink-0 rounded object-cover"
                            loading="lazy"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          {article.url ? (
                            <a
                              href={article.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm font-semibold hover:underline line-clamp-2"
                            >
                              {article.title}
                            </a>
                          ) : (
                            <p className="text-sm font-semibold line-clamp-2">{article.title}</p>
                          )}
                          <p className={`mt-0.5 text-xs ${isDarkMode ? "text-zinc-500" : "text-zinc-500"}`}>
                            {[article.date, article.authors?.join(", ")].filter(Boolean).join(" · ")}
                          </p>
                        </div>
                      </div>
                    ))}
                    {htmlToRssPreviewArticles.length > 10 && (
                      <p className={`text-xs ${isDarkMode ? "text-zinc-500" : "text-zinc-500"}`}>
                        ...and {htmlToRssPreviewArticles.length - 10} more
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>

            <div className={`flex justify-end gap-2 border-t p-4 ${isDarkMode ? "border-zinc-800" : "border-zinc-200"}`}>
              <button
                type="button"
                onClick={() => setShowHtmlToRssPreview(false)}
                disabled={htmlToRssSaving}
                className={`inline-flex items-center gap-1 rounded-lg border px-4 py-2 text-xs font-bold uppercase tracking-widest transition-colors ${
                  isDarkMode
                    ? "border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                    : "border-zinc-300 bg-zinc-200 text-zinc-700 hover:bg-zinc-300"
                } disabled:cursor-not-allowed disabled:opacity-50`}
              >
                Cancel
              </button>
              {!htmlToRssPreviewError && (
                <button
                  type="button"
                  disabled={htmlToRssSaving}
                  onClick={() => {
                    if (htmlToRssSaving) return;
                    setHtmlToRssSaving(true);
                    feedService
                      .saveHtmlToRssRule({
                        url: htmlToRssUrl.trim(),
                        display_name: htmlToRssName.trim(),
                        container_selector: htmlToRssContainerSelector.trim(),
                        title_selector: htmlToRssTitleSelector.trim(),
                        link_selector: htmlToRssLinkSelector.trim(),
                        date_selector: htmlToRssDateSelector.trim(),
                        thumbnail_selector: htmlToRssThumbnailSelector.trim(),
                        snippet_selector: htmlToRssSnippetSelector.trim(),
                        author_selector: htmlToRssAuthorSelector.trim(),
                      })
                      .then(async () => {
                        setShowHtmlToRssPreview(false);
                        setShowHtmlToRss(false);
                        await onRefresh();
                      })
                      .catch((err) => {
                        setHtmlToRssPreviewError(String(err));
                      })
                      .finally(() => setHtmlToRssSaving(false));
                  }}
                  className={`inline-flex items-center gap-1 rounded-lg border px-4 py-2 text-xs font-bold uppercase tracking-widest transition-colors ${
                    isDarkMode
                      ? "border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                      : "border-zinc-300 bg-zinc-200 text-zinc-700 hover:bg-zinc-300"
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  <Check size={12} /> {htmlToRssSaving ? "Saving..." : "Confirm"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
