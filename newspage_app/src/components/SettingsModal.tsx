import { invoke } from "@tauri-apps/api/core";
import { FolderOpen, RefreshCw, Search, Settings, Sparkles, Trash2, X } from "lucide-react";
import { DotsSpinner } from "./DotsSpinner";
import type React from "react";
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { addSourceToBlacklist, normalizeSourceName, removeSourceFromBlacklist } from "../utils/sourceBlacklist";
import { NeonCheckbox } from "./NeonCheckbox";
import {
  AVAILABLE_REGIONS,
  CLAUDE_MODELS,
  EMBEDDING_MODEL_INFO,
  GEMINI_MODELS,
  OPENAI_MODELS,
  type OllamaConnectionState,
} from "../constants/article";
import type { FeedSource, LocalEmbeddingStatus, UserSettings } from "../types/article";
import { usePanelTransition } from "../hooks/usePanelTransition";

interface SettingsModalProps {
  showSettings: boolean;
  isDarkMode: boolean;
  settings: UserSettings;
  setSettings: Dispatch<SetStateAction<UserSettings>>;
  saveSetting: (key: string, value: string) => void;
  ollamaConnectionState: OllamaConnectionState;
  setOllamaConnectionState: Dispatch<SetStateAction<OllamaConnectionState>>;
  isTestingOllama: boolean;
  testOllamaConnection: (address: string) => Promise<void>;
  ollamaModels: string[];
  isRefreshingModels: boolean;
  refreshOllamaModels: (address: string, preferredModel?: string) => Promise<void>;
  localEmbeddingModels: string[];
  selectedEmbeddingModel: string;
  onSelectEmbeddingModel: Dispatch<SetStateAction<string>>;
  localEmbeddingStatus: LocalEmbeddingStatus | null;
  isPreparingLocalEmbeddingModel: boolean;
  onPrepareLocalEmbeddingModel: (model: string) => Promise<void>;
  isEmbeddingConfigured: boolean;
  purgeConfirmStep: 0 | 1 | 2;
  setPurgeConfirmStep: Dispatch<SetStateAction<0 | 1 | 2>>;
  isPurging: boolean;
  setIsPurging: Dispatch<SetStateAction<boolean>>;
  onPurgeDatabase: () => Promise<void>;
  onOpenCategoryLimits: () => void;
  onOpenCustomRssFeedSettings: () => void;
  feedSources: FeedSource[];
  onClose: () => void;
  scrollToEmbedding: boolean;
  onScrollConsumed: () => void;
  showOnboardingHints: boolean;
  onDismissHint: (hint: "googleNews" | "rss") => void;
}

export function SettingsModal({
  showSettings,
  isDarkMode,
  settings,
  setSettings,
  saveSetting,
  ollamaConnectionState,
  setOllamaConnectionState,
  isTestingOllama,
  testOllamaConnection,
  ollamaModels,
  isRefreshingModels,
  refreshOllamaModels,
  localEmbeddingModels,
  selectedEmbeddingModel,
  onSelectEmbeddingModel,
  localEmbeddingStatus,
  isPreparingLocalEmbeddingModel,
  onPrepareLocalEmbeddingModel,
  isEmbeddingConfigured,
  purgeConfirmStep,
  setPurgeConfirmStep,
  isPurging,
  setIsPurging,
  onPurgeDatabase,
  onOpenCategoryLimits,
  onOpenCustomRssFeedSettings,
  feedSources,
  onClose,
  scrollToEmbedding,
  onScrollConsumed,
  showOnboardingHints,
  onDismissHint,
}: SettingsModalProps): React.JSX.Element | null {
  const { isMounted, isClosing } = usePanelTransition(showSettings, 170);

  // Refs for scroll-to and bubble positioning
  const embeddingSectionRef = useRef<HTMLDivElement>(null);
  const googleNewsSectionRef = useRef<HTMLDivElement>(null);
  const rssFeedSectionRef = useRef<HTMLDivElement>(null);
  const llmSectionRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // LLM section glow: counter so repeated toggles always re-fire the effect
  const [llmGlowTrigger, setLlmGlowTrigger] = useState(0);
  const [llmGlowing, setLlmGlowing] = useState(false);

  // Inline blacklist state
  const [blacklistQuery, setBlacklistQuery] = useState("");
  const [blacklistDraft, setBlacklistDraft] = useState("");

  const filteredBlacklistSources = useMemo(() => {
    const normalizedQuery = normalizeSourceName(blacklistQuery);
    const sorted = [...settings.sourceBlacklist].sort((a, b) => a.localeCompare(b));
    if (!normalizedQuery) return sorted;
    return sorted.filter((source) => normalizeSourceName(source).includes(normalizedQuery));
  }, [blacklistQuery, settings.sourceBlacklist]);

  const updateBlacklist = (nextSources: string[]) => {
    setSettings((current) => ({ ...current, sourceBlacklist: nextSources }));
    saveSetting("sourceBlacklist", JSON.stringify(nextSources));
  };

  const addBlacklistDraft = () => {
    const nextSources = addSourceToBlacklist(settings.sourceBlacklist, blacklistDraft);
    if (nextSources === settings.sourceBlacklist) return;
    updateBlacklist(nextSources);
    setBlacklistDraft("");
  };

  // Local dismissed state for each bubble — reset whenever hints become active
  const [googleNewsBubbleDismissed, setGoogleNewsBubbleDismissed] = useState(false);
  const [rssBubbleDismissed, setRssBubbleDismissed] = useState(false);

  // Visibility state for 70% in-view fade
  const [googleNewsVisible, setGoogleNewsVisible] = useState(false);
  const [rssVisible, setRssVisible] = useState(false);

  useEffect(() => {
    if (showOnboardingHints) {
      setGoogleNewsBubbleDismissed(false);
      setRssBubbleDismissed(false);
      setGoogleNewsVisible(false);
      setRssVisible(false);
    }
  }, [showOnboardingHints]);

  // IntersectionObserver: show bubbles only when section ≥70% visible
  useEffect(() => {
    if (!showOnboardingHints || !isMounted) return;
    const root = scrollContainerRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.target === googleNewsSectionRef.current) {
            setGoogleNewsVisible(entry.isIntersecting);
          }
          if (entry.target === rssFeedSectionRef.current) {
            setRssVisible(entry.isIntersecting);
          }
        }
      },
      { root, threshold: 0.7 },
    );
    if (googleNewsSectionRef.current) observer.observe(googleNewsSectionRef.current);
    if (rssFeedSectionRef.current) observer.observe(rssFeedSectionRef.current);
    return () => observer.disconnect();
  }, [showOnboardingHints, isMounted]);

  // Scroll to embedding section when requested
  useEffect(() => {
    if (scrollToEmbedding && isMounted && embeddingSectionRef.current) {
      // Small delay to let the modal finish its entry animation
      const timer = setTimeout(() => {
        embeddingSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        onScrollConsumed();
      }, 220);
      return () => clearTimeout(timer);
    }
  }, [scrollToEmbedding, isMounted, onScrollConsumed]);

  // Scroll to LLM section and glow it when AI mode is toggled on
  useEffect(() => {
    if (llmGlowTrigger === 0) return;
    const scrollTimer = setTimeout(() => {
      llmSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      setLlmGlowing(true);
    }, 220);
    const clearTimer = setTimeout(() => {
      setLlmGlowing(false);
    }, 4400);
    return () => {
      clearTimeout(scrollTimer);
      clearTimeout(clearTimer);
    };
  }, [llmGlowTrigger]);

  if (!isMounted) {
    return null;
  }

  const embeddingIsBusy =
    isPreparingLocalEmbeddingModel
    || localEmbeddingStatus?.state === "downloading"
    || localEmbeddingStatus?.state === "loading";
  const embeddingSelectionLocked = isEmbeddingConfigured;
  const effectiveEmbeddingModel = isEmbeddingConfigured ? settings.localEmbeddingModel : selectedEmbeddingModel;
  const selectedModelReady =
    localEmbeddingStatus?.state === "ready" &&
    (localEmbeddingStatus.active_model ?? "").toLowerCase() === effectiveEmbeddingModel.toLowerCase();
  const downloadButtonDisabled = embeddingIsBusy || isEmbeddingConfigured;
  const embeddingModelTooltip = isEmbeddingConfigured
    ? "Embedding model is locked after setup to keep relevance sorting consistent. Use Clean Reset in the Danger Zone to choose a different model."
    : "Select the local embedding model used for relevance sorting.";
  const APP_VERSION = "0.1.0";
  const FRONTEND_VERSION = "0.1.0";
  const APP_IDENTIFIER = "com.newspage";
  const REPO_URL = "https://github.com/xht8723/NewsPage";

  return (
    <div className={`${isClosing ? "popup-overlay-out" : "popup-overlay"} fixed inset-0 z-50 flex items-center justify-center p-4`}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className={`${isClosing ? "popup-panel-out" : "popup-panel"} relative w-full max-w-6xl overflow-hidden rounded-3xl border shadow-2xl ${
          isDarkMode ? "border-zinc-800 bg-zinc-900 text-zinc-300" : "border-zinc-200 bg-zinc-150 text-zinc-800"
        }`}
      >
        <div
          className={`flex items-center justify-between border-b p-6 ${
            isDarkMode ? "border-zinc-800 bg-zinc-950/50" : "border-zinc-200 bg-zinc-150"
          }`}
        >
          <div className="flex items-center gap-2">
            <Settings size={18} className="text-zinc-500" />
            <h3 className="text-base font-bold uppercase tracking-widest">Preferences</h3>
          </div>
          <button onClick={onClose} className="hover:opacity-50">
            <X size={18} />
          </button>
        </div>
        <div ref={scrollContainerRef} className={`max-h-[calc(100vh-10rem)] space-y-6 overflow-y-auto p-6 news-scroll ${isDarkMode ? "news-scroll-dark" : "news-scroll-light"}`}>
          <div className="space-y-4">
            {/* General Settings */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-10">
              <div className={`order-2 rounded-xl border p-4 lg:order-1 lg:col-span-7 ${isDarkMode ? "border-zinc-800 bg-zinc-950/40" : "border-zinc-200 bg-zinc-150"}`}>
                <p className={`mb-3 text-[10px] font-bold uppercase tracking-widest ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>General Settings</p>
                <div className="space-y-3">
                  <div>
                    <button
                      type="button"
                      onClick={() => {
                        const next = !settings.aiModeEnabled;
                        setSettings((current) => ({ ...current, aiModeEnabled: next }));
                        saveSetting("aiModeEnabled", next ? "true" : "false");
                        if (next) setLlmGlowTrigger((n) => n + 1);
                      }}
                      className={`w-full rounded-xl border px-4 py-3 text-left transition-all duration-200 ${
                        settings.aiModeEnabled
                          ? isDarkMode
                            ? "border-cyan-700/60 bg-cyan-950/50 hover:bg-cyan-950/70"
                            : "border-emerald-400/60 bg-emerald-50 hover:bg-emerald-100/80"
                          : isDarkMode
                            ? "border-zinc-700 bg-zinc-800/60 hover:bg-zinc-800"
                            : "border-zinc-300 bg-zinc-100 hover:bg-zinc-200/60"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className={`rounded-lg p-1.5 transition-colors duration-200 ${
                            settings.aiModeEnabled
                              ? isDarkMode ? "bg-cyan-900/60 text-cyan-400" : "bg-emerald-100 text-emerald-600"
                              : isDarkMode ? "bg-zinc-700/60 text-zinc-500" : "bg-zinc-200 text-zinc-400"
                          }`}>
                            <Sparkles size={16} />
                          </div>
                          <div>
                            <p className={`text-sm font-semibold transition-colors duration-200 ${
                              settings.aiModeEnabled
                                ? isDarkMode ? "text-cyan-300" : "text-emerald-700"
                                : isDarkMode ? "text-zinc-400" : "text-zinc-500"
                            }`}>AI Mode</p>
                            <p className={`text-[11px] transition-colors duration-200 ${
                              isDarkMode ? "text-zinc-500" : "text-zinc-400"
                            }`}>Summarise, tag and rank articles with LLM</p>
                          </div>
                        </div>
                        <span className={`shrink-0 rounded-md px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest transition-all duration-200 ${
                          settings.aiModeEnabled
                            ? isDarkMode ? "bg-cyan-800/60 text-cyan-300" : "bg-emerald-200 text-emerald-700"
                            : isDarkMode ? "bg-zinc-700 text-zinc-500" : "bg-zinc-200 text-zinc-400"
                        }`}>
                          {settings.aiModeEnabled ? "ON" : "OFF"}
                        </span>
                      </div>
                    </button>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium opacity-70">Deletion confirmation</label>
                    <label className="flex cursor-pointer items-center gap-2">
                      <NeonCheckbox
                        checked={settings.showFeedDeletionConfirmation}
                        onChange={(checked) => {
                          setSettings((current) => ({ ...current, showFeedDeletionConfirmation: checked }));
                          saveSetting("showFeedDeletionConfirmation", checked ? "true" : "false");
                        }}
                        isDarkMode={isDarkMode}
                        ariaLabel="Show deletion confirmation"
                      />
                      <span className="text-sm">Show deletion confirmation</span>
                    </label>
                  </div>
                </div>
              </div>

              <div className={`order-1 rounded-xl border p-4 lg:order-2 lg:col-span-3 ${isDarkMode ? "border-zinc-800 bg-zinc-950/40" : "border-zinc-200 bg-zinc-150"}`}>
                <div className={`rounded-lg border p-3 ${isDarkMode ? "border-zinc-800 bg-zinc-900/70" : "border-zinc-200 bg-white/80"}`}>
                  <div className="flex items-start gap-3">
                    <div className={`rounded-lg border p-1.5 ${isDarkMode ? "border-zinc-700 bg-zinc-900" : "border-zinc-300 bg-white"}`}>
                      <img src="/icon.png" alt="NewsPage logo" className="h-10 w-10 rounded object-contain" />
                    </div>
                    <div className="min-w-0">
                      <p className={`text-[10px] font-bold uppercase tracking-widest ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>Info</p>
                      <h4 className={`truncate text-sm font-bold ${isDarkMode ? "text-zinc-100" : "text-zinc-900"}`}>NewsPage</h4>
                      <p className={`mt-0.5 text-[11px] ${isDarkMode ? "text-zinc-400" : "text-zinc-500"}`}>AI desktop news reader</p>
                    </div>
                  </div>

                  <div className="mt-3 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between gap-3">
                      <span className={isDarkMode ? "text-zinc-500" : "text-zinc-500"}>Version</span>
                      <span className={isDarkMode ? "text-zinc-200" : "text-zinc-800"}>{APP_VERSION}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className={isDarkMode ? "text-zinc-500" : "text-zinc-500"}>Frontend</span>
                      <span className={isDarkMode ? "text-zinc-200" : "text-zinc-800"}>Vite {FRONTEND_VERSION}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className={isDarkMode ? "text-zinc-500" : "text-zinc-500"}>Desktop</span>
                      <span className={isDarkMode ? "text-zinc-200" : "text-zinc-800"}>Tauri 2</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className={isDarkMode ? "text-zinc-500" : "text-zinc-500"}>Identifier</span>
                      <span className={`truncate text-right ${isDarkMode ? "text-zinc-200" : "text-zinc-800"}`}>{APP_IDENTIFIER}</span>
                    </div>
                  </div>

                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => {
                        void invoke("open_url", { url: REPO_URL });
                      }}
                      className={`text-[11px] font-semibold underline-offset-4 hover:underline ${
                        isDarkMode
                          ? "text-zinc-300 hover:text-zinc-100"
                          : "text-zinc-700 hover:text-zinc-900"
                      }`}
                    >
                      GitHub Repository
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Article Settings + Media Outlet Blacklist */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className={`rounded-xl border p-4 ${isDarkMode ? "border-zinc-800 bg-zinc-950/40" : "border-zinc-200 bg-zinc-150"}`}>
              <p className={`mb-3 text-[10px] font-bold uppercase tracking-widest ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>Article Settings</p>
              <div className="space-y-3">
                <div>
                  <label className="mb-1.5 block text-xs font-medium opacity-70">Number of news per category per pull</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={settings.newsLimit}
                      onChange={(e) => {
                        const val = Math.min(100, Math.max(1, Number(e.target.value)));
                        setSettings((s) => ({ ...s, newsLimit: val }));
                        saveSetting("newsLimit", String(val));
                      }}
                      className={`number-dial-${isDarkMode ? "dark" : "light"} w-20 rounded-lg border px-3 py-2 text-sm font-semibold focus:outline-none ${
                        isDarkMode
                          ? "border-zinc-700 bg-zinc-800 text-zinc-100"
                          : "border-zinc-300 bg-zinc-200 text-zinc-900"
                      }`}
                    />
                    <button
                      type="button"
                      onClick={onOpenCategoryLimits}
                      className={`shrink-0 rounded-lg border px-2.5 py-2 text-xs font-semibold transition-opacity hover:opacity-70 ${
                        isDarkMode
                          ? "border-zinc-700 bg-zinc-800 text-zinc-300"
                          : "border-zinc-300 bg-zinc-200 text-zinc-700"
                      }`}
                    >
                      Detailed
                    </button>
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium opacity-70">Scrape cooldown (hours)</label>
                  <p className="mb-1.5 text-xs opacity-50">Min time between website scrapes. 0 = always scrape.</p>
                  <div>
                    <div className="relative h-6 w-full">
                      <div className={`absolute top-1/2 h-1.5 w-full -translate-y-1/2 rounded-full ${isDarkMode ? "bg-zinc-700" : "bg-zinc-300"}`} />
                      <div
                        className={`absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full ${isDarkMode ? "bg-cyan-600/85" : "bg-emerald-500"}`}
                        style={{ left: 0, width: `${(settings.scrapeCooldownHours / 24) * 100}%` }}
                      />
                      <input
                        type="range"
                        min={0}
                        max={24}
                        step={1}
                        value={settings.scrapeCooldownHours}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setSettings((s) => ({ ...s, scrapeCooldownHours: val }));
                          saveSetting("scrapeCooldownHours", String(val));
                        }}
                        className={`absolute top-0 h-6 w-full appearance-none bg-transparent [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 ${
                          isDarkMode
                            ? "[&::-moz-range-thumb]:border-cyan-600 [&::-moz-range-thumb]:bg-zinc-900 [&::-webkit-slider-thumb]:border-cyan-600 [&::-webkit-slider-thumb]:bg-zinc-900"
                            : "[&::-moz-range-thumb]:border-emerald-500 [&::-moz-range-thumb]:bg-white [&::-webkit-slider-thumb]:border-emerald-500 [&::-webkit-slider-thumb]:bg-white"
                        }`}
                      />
                    </div>
                    <div className="mt-1 flex items-center justify-between">
                      <span className={`text-[10px] ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>0</span>
                      <span className={`text-xs font-semibold ${isDarkMode ? "text-zinc-300" : "text-zinc-700"}`}>{settings.scrapeCooldownHours} h</span>
                      <span className={`text-[10px] ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>24</span>
                    </div>
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium opacity-70">LLM batch size</label>
                  <p className="mb-1.5 text-xs opacity-50">How many articles for the LLM to process in a single batch.</p>
                  <div>
                    <div className="relative h-6 w-full">
                      <div className={`absolute top-1/2 h-1.5 w-full -translate-y-1/2 rounded-full ${isDarkMode ? "bg-zinc-700" : "bg-zinc-300"}`} />
                      <div
                        className={`absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full ${isDarkMode ? "bg-cyan-600/85" : "bg-emerald-500"}`}
                        style={{ left: 0, width: `${((settings.llmBatchSize - 1) / (10 - 1)) * 100}%` }}
                      />
                      <input
                        type="range"
                        min={1}
                        max={10}
                        step={1}
                        value={settings.llmBatchSize}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setSettings((s) => ({ ...s, llmBatchSize: val }));
                          saveSetting("llmBatchSize", String(val));
                        }}
                        className={`absolute top-0 h-6 w-full appearance-none bg-transparent [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 ${
                          isDarkMode
                            ? "[&::-moz-range-thumb]:border-cyan-600 [&::-moz-range-thumb]:bg-zinc-900 [&::-webkit-slider-thumb]:border-cyan-600 [&::-webkit-slider-thumb]:bg-zinc-900"
                            : "[&::-moz-range-thumb]:border-emerald-500 [&::-moz-range-thumb]:bg-white [&::-webkit-slider-thumb]:border-emerald-500 [&::-webkit-slider-thumb]:bg-white"
                        }`}
                      />
                    </div>
                    <div className="mt-1 flex items-center justify-between">
                      <span className={`text-[10px] ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>1</span>
                      <span className={`text-xs font-semibold ${isDarkMode ? "text-zinc-300" : "text-zinc-700"}`}>{settings.llmBatchSize}</span>
                      <span className={`text-[10px] ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>10</span>
                    </div>
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium opacity-70">Summary bullet points</label>
                  <p className="mb-1.5 text-xs opacity-50">Range of bullet points per article summary.</p>
                  {(() => {
                    const SLIDER_MIN = 1;
                    const SLIDER_MAX = 20;
                    const minVal = settings.minSummaryPoints ?? 1;
                    const maxVal = settings.maxSummaryPoints ?? 8;
                    const leftPct = ((minVal - SLIDER_MIN) / (SLIDER_MAX - SLIDER_MIN)) * 100;
                    const rightPct = ((maxVal - SLIDER_MIN) / (SLIDER_MAX - SLIDER_MIN)) * 100;
                    return (
                      <div>
                        <div className="relative h-6 w-full">
                          {/* Track background */}
                          <div className={`absolute top-1/2 h-1.5 w-full -translate-y-1/2 rounded-full ${isDarkMode ? "bg-zinc-700" : "bg-zinc-300"}`} />
                          {/* Active range fill */}
                          <div
                            className={`absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full ${isDarkMode ? "bg-cyan-600/85" : "bg-emerald-500"}`}
                            style={{ left: `${leftPct}%`, width: `${rightPct - leftPct}%` }}
                          />
                          {/* Min thumb */}
                          <input
                            type="range"
                            min={SLIDER_MIN}
                            max={SLIDER_MAX}
                            value={minVal}
                            onChange={(e) => {
                              const val = Math.min(Number(e.target.value), maxVal);
                              setSettings((s) => ({ ...s, minSummaryPoints: val }));
                              saveSetting("minSummaryPoints", String(val));
                            }}
                            className={`pointer-events-none absolute top-0 h-6 w-full appearance-none bg-transparent [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 ${
                              isDarkMode
                                ? "[&::-moz-range-thumb]:border-cyan-600 [&::-moz-range-thumb]:bg-zinc-900 [&::-webkit-slider-thumb]:border-cyan-600 [&::-webkit-slider-thumb]:bg-zinc-900"
                                : "[&::-moz-range-thumb]:border-emerald-500 [&::-moz-range-thumb]:bg-white [&::-webkit-slider-thumb]:border-emerald-500 [&::-webkit-slider-thumb]:bg-white"
                            }`}
                            style={{ zIndex: minVal > SLIDER_MAX - 2 ? 5 : 3 }}
                          />
                          {/* Max thumb */}
                          <input
                            type="range"
                            min={SLIDER_MIN}
                            max={SLIDER_MAX}
                            value={maxVal}
                            onChange={(e) => {
                              const val = Math.max(Number(e.target.value), minVal);
                              setSettings((s) => ({ ...s, maxSummaryPoints: val }));
                              saveSetting("maxSummaryPoints", String(val));
                            }}
                            className={`pointer-events-none absolute top-0 h-6 w-full appearance-none bg-transparent [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 ${
                              isDarkMode
                                ? "[&::-moz-range-thumb]:border-cyan-600 [&::-moz-range-thumb]:bg-zinc-900 [&::-webkit-slider-thumb]:border-cyan-600 [&::-webkit-slider-thumb]:bg-zinc-900"
                                : "[&::-moz-range-thumb]:border-emerald-500 [&::-moz-range-thumb]:bg-white [&::-webkit-slider-thumb]:border-emerald-500 [&::-webkit-slider-thumb]:bg-white"
                            }`}
                            style={{ zIndex: 4 }}
                          />
                        </div>
                        <div className="mt-1 flex items-center justify-between">
                          <span className={`text-[10px] ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>{SLIDER_MIN}</span>
                          <span className={`text-xs font-semibold ${isDarkMode ? "text-zinc-300" : "text-zinc-700"}`}>{minVal} &ndash; {maxVal} points</span>
                          <span className={`text-[10px] ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>{SLIDER_MAX}</span>
                        </div>
                      </div>
                    );
                  })()}
                 </div>
               </div>
             </div>

              <div className={`rounded-xl border p-4 ${isDarkMode ? "border-zinc-800 bg-zinc-950/40" : "border-zinc-200 bg-zinc-150"}`}>
                <p className={`mb-3 text-[10px] font-bold uppercase tracking-widest ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>Media Outlet Blacklist</p>
                <div className="space-y-2">
                  {/* Search + Clear All */}
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto]">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 opacity-50" />
                      <input
                        type="text"
                        placeholder="Search source name"
                        value={blacklistQuery}
                        onChange={(e) => setBlacklistQuery(e.target.value)}
                        className={`w-full rounded-lg border py-2 pl-8 pr-3 text-xs focus:outline-none ${
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

                  {/* List */}
                  <div className={`max-h-40 overflow-y-auto rounded-xl border news-scroll ${isDarkMode ? "news-scroll-dark border-zinc-800" : "news-scroll-light border-zinc-200"}`}>
                    {filteredBlacklistSources.length === 0 ? (
                      <p className={`p-3 text-xs ${isDarkMode ? "text-zinc-500" : "text-zinc-500"}`}>
                        {settings.sourceBlacklist.length === 0 ? "No blacklisted sources yet." : "No sources match your search."}
                      </p>
                    ) : (
                      <div className={`divide-y ${isDarkMode ? "divide-zinc-800/70" : "divide-zinc-200"}`}>
                        {filteredBlacklistSources.map((source) => (
                          <div key={`blacklist-${normalizeSourceName(source)}`} className="flex items-center justify-between gap-3 px-3 py-2">
                            <span className="truncate text-xs font-medium">{source}</span>
                            <button
                              type="button"
                              onClick={() => updateBlacklist(removeSourceFromBlacklist(settings.sourceBlacklist, source))}
                              className={`inline-flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-bold uppercase tracking-widest transition-colors ${
                                isDarkMode
                                  ? "border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                                  : "border-zinc-300 bg-zinc-150 text-zinc-700 hover:bg-zinc-200"
                              }`}
                            >
                              <Trash2 size={11} /> Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Add source */}
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto]">
                    <input
                      type="text"
                      placeholder="Add source name manually"
                      value={blacklistDraft}
                      onChange={(e) => setBlacklistDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); addBlacklistDraft(); }
                      }}
                      className={`w-full rounded-lg border px-3 py-2 text-xs focus:outline-none ${
                        isDarkMode
                          ? "border-zinc-700 bg-zinc-800 text-zinc-100 placeholder-zinc-600"
                          : "border-zinc-300 bg-zinc-200 text-zinc-900 placeholder-zinc-500"
                      }`}
                    />
                    <button
                      type="button"
                      onClick={addBlacklistDraft}
                      className={`rounded-lg border px-3 py-2 text-xs font-bold uppercase tracking-widest transition-colors ${
                        isDarkMode
                          ? "border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                          : "border-zinc-300 bg-zinc-150 text-zinc-700 hover:bg-zinc-200"
                      }`}
                    >
                      Add
                    </button>
                  </div>
                </div>
               </div>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div ref={googleNewsSectionRef} className={`relative rounded-xl border p-4 ${isDarkMode ? "border-zinc-800 bg-zinc-950/40" : "border-zinc-200 bg-zinc-150"}`}>
                {/* Onboarding tooltip bubble: Google News Regions */}
                {showOnboardingHints && !googleNewsBubbleDismissed && (
                  <div className={`onboarding-bubble ${isDarkMode ? "" : "onboarding-bubble-light"} left-0 right-0 bottom-full mb-2 rounded-xl border px-4 py-3 shadow-xl ${
                    isDarkMode
                      ? "border-cyan-800/60 bg-zinc-900/95 text-zinc-300"
                      : "border-cyan-300 bg-white text-zinc-700"
                  } ${googleNewsVisible ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-xs leading-relaxed">
                        <strong className={isDarkMode ? "text-white" : "text-cyan-600"}>Choose your regions for news!</strong> 
                        <br />{}
                        Multiple regions supported!
                      </p>
                      <button
                        type="button"
                        onClick={() => { setGoogleNewsBubbleDismissed(true); onDismissHint("googleNews"); }}
                        className={`shrink-0 rounded p-0.5 transition-opacity hover:opacity-60 ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}
                      >
                        <X size={13} />
                      </button>
                    </div>
                  </div>
                )}
                <p className={`mb-3 text-[10px] font-bold uppercase tracking-widest ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>Google News Regions</p>
                <p className={`mb-3 text-xs ${isDarkMode ? "text-zinc-400" : "text-zinc-500"}`}>Select regions for Google News sources</p>
                <div className="space-y-2">
                  {AVAILABLE_REGIONS.map((region) => {
                    const checked = settings.selectedRegions.includes(region.id);
                    return (
                      <label key={region.id} className="flex items-center gap-2 cursor-pointer">
                        <NeonCheckbox
                          checked={checked}
                          onChange={() => {
                            const next = checked
                              ? settings.selectedRegions.filter((r) => r !== region.id)
                              : [...settings.selectedRegions, region.id];
                            setSettings((s) => ({ ...s, selectedRegions: next }));
                            saveSetting("selectedRegions", JSON.stringify(next));
                          }}
                          isDarkMode={isDarkMode}
                          size="sm"
                          ariaLabel={`Toggle ${region.label}`}
                        />
                        <span className="text-sm">{region.label}</span>
                      </label>
                    );
                  })}
                </div>
                {settings.selectedRegions.length === 0 && (
                  <p className="mt-2 text-xs text-amber-500">No regions selected. Google News RSS will be skipped during scraping.</p>
                )}
              </div>

              <div ref={rssFeedSectionRef} className={`relative rounded-xl border p-4 ${isDarkMode ? "border-zinc-800 bg-zinc-950/40" : "border-zinc-200 bg-zinc-150"}`}>
                {/* Onboarding tooltip bubble: RSS Feed Settings */}
                {showOnboardingHints && !rssBubbleDismissed && (
                  <div className={`onboarding-bubble ${isDarkMode ? "" : "onboarding-bubble-light"} left-0 right-0 bottom-full mb-2 rounded-xl border px-4 py-3 shadow-xl ${
                    isDarkMode
                      ? "border-cyan-800/60 bg-zinc-900/95 text-zinc-300"
                      : "border-cyan-300 bg-white text-zinc-700"
                  } ${rssVisible ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-xs leading-relaxed">
                        <strong className={isDarkMode ? "text-white" : "text-cyan-600"}>Add your own RSS sources!</strong>
                        <br />{} Or select what we provides!
                      </p>
                      <button
                        type="button"
                        onClick={() => { setRssBubbleDismissed(true); onDismissHint("rss"); }}
                        className={`shrink-0 rounded p-0.5 transition-opacity hover:opacity-60 ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}
                      >
                        <X size={13} />
                      </button>
                    </div>
                  </div>
                )}
                <p className={`mb-3 text-[10px] font-bold uppercase tracking-widest ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>RSS Feed Settings</p>
                <p className={`mb-3 text-xs ${isDarkMode ? "text-zinc-400" : "text-zinc-500"}`}>
                  Configure custom RSS feeds. Assign sources to feeds in Feed Settings.
                </p>
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={onOpenCustomRssFeedSettings}
                    className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-xs font-bold uppercase tracking-widest transition-colors ${
                      isDarkMode
                        ? "border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                        : "border-zinc-300 bg-zinc-200 text-zinc-700 hover:bg-zinc-300"
                    }`}
                  >
                    <span>Custom RSS Feed</span>
                    <span className="text-[10px] opacity-70">{feedSources.filter((s) => ["ann", "automaton", "gcores", "yys", "custom_rss"].includes(s.source_type)).length} saved</span>
                  </button>
                </div>
              </div>
            </div>

            <div className={`grid grid-cols-1 gap-4 ${settings.aiModeEnabled ? "lg:grid-cols-2" : "lg:grid-cols-1"}`}>
              <div ref={embeddingSectionRef} className={`rounded-xl border p-4 ${isDarkMode ? "border-zinc-800 bg-zinc-950/40" : "border-zinc-200 bg-zinc-150"}`}>
                <p className={`mb-3 text-[10px] font-bold uppercase tracking-widest ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>Embedding Settings</p>
                <div className="space-y-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium opacity-70">Local Embedding Model (Relevance)</label>
                    <select
                      value={effectiveEmbeddingModel}
                      disabled={embeddingSelectionLocked}
                      title={embeddingModelTooltip}
                      onChange={(e) => {
                        const val = e.target.value;
                        onSelectEmbeddingModel(val);
                      }}
                      className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none ${
                        isDarkMode
                          ? "border-zinc-700 bg-zinc-800 text-zinc-100"
                          : "border-zinc-300 bg-zinc-200 text-zinc-900"
                      } ${embeddingSelectionLocked ? "opacity-60" : ""}`}
                    >
                      {localEmbeddingModels.map((model) => {
                        const info = EMBEDDING_MODEL_INFO[model];
                        const label = info ? `${model}  (${info.size}, ${info.dims}d, ${info.langs})` : model;
                        return <option key={`embed-${model}`} value={model}>{label}</option>;
                      })}
                      {localEmbeddingModels.length === 0 && <option value={effectiveEmbeddingModel}>{effectiveEmbeddingModel}</option>}
                    </select>
                    {!embeddingSelectionLocked && (
                      <p className={`mt-2 text-[11px] ${isDarkMode ? "text-zinc-400" : "text-zinc-500"}`}>
                        Choose your embedding model and click Download Model. The model is only saved after the download succeeds.
                      </p>
                    )}
                    <div className="mt-2 flex items-start justify-end">
                      <button
                        type="button"
                        disabled={downloadButtonDisabled}
                        onClick={() => void onPrepareLocalEmbeddingModel(effectiveEmbeddingModel)}
                        className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest transition-colors ${
                          isDarkMode
                            ? `border-zinc-700 bg-zinc-800 text-zinc-200 ${downloadButtonDisabled ? "" : "hover:bg-zinc-700"}`
                            : `border-zinc-300 bg-zinc-150 text-zinc-700 ${downloadButtonDisabled ? "" : "hover:bg-zinc-200"}`
                        } shrink-0 disabled:opacity-50 ${showOnboardingHints && !downloadButtonDisabled && !embeddingIsBusy ? "embedding-download-glow" : ""}`}
                      >
                        <RefreshCw size={12} className={embeddingIsBusy ? "animate-spin" : ""} />
                        {embeddingIsBusy ? "Preparing..." : selectedModelReady ? "Downloaded" : "Download Model"}
                      </button>
                    </div>
                    <p className={`mt-2 break-all text-[11px] ${isDarkMode ? "text-zinc-400" : "text-zinc-500"}`}>
                      {localEmbeddingStatus
                        ? localEmbeddingStatus.message
                        : "Model status unavailable"}
                    </p>
                    {embeddingIsBusy && (
                      <DotsSpinner size={20} className="mt-3 text-zinc-500" />
                    )}
                  </div>
                  <div>
                    <button
                      type="button"
                      onClick={() => void invoke("open_app_data_dir")}
                      className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                        isDarkMode
                          ? "border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                          : "border-zinc-300 bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
                      }`}
                    >
                      <FolderOpen className="h-4 w-4 shrink-0" />
                      Open App Data Folder
                    </button>
                  </div>
                </div>
              </div>

              {settings.aiModeEnabled && (
                <div ref={llmSectionRef} className={`rounded-xl border p-4 ${isDarkMode ? "border-zinc-800 bg-zinc-950/40" : "border-zinc-200 bg-zinc-150"} ${llmGlowing ? "llm-section-glow" : ""}`}>
                  <p className={`mb-3 text-[10px] font-bold uppercase tracking-widest ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>LLM Provider Settings</p>
                  <div className="space-y-3">
                    <div>
                      <label className="mb-1.5 block text-xs font-medium opacity-70">LLM Provider</label>
                      <select
                        value={settings.llmProvider}
                        onChange={(e) => {
                          const val = e.target.value;
                          setSettings((s) => ({ ...s, llmProvider: val }));
                          saveSetting("llmProvider", val);
                        }}
                        className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none ${
                          isDarkMode
                            ? "border-zinc-700 bg-zinc-800 text-zinc-100"
                            : "border-zinc-300 bg-zinc-200 text-zinc-900"
                        }`}
                      >
                        <option value="ollama">Ollama (Local)</option>
                        <option value="openai">OpenAI</option>
                        <option value="claude">Claude (Anthropic)</option>
                        <option value="gemini">Google Gemini</option>
                      </select>
                    </div>

                    {settings.llmProvider === "ollama" && (
                      <>
                        <div>
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <label className="text-xs font-medium opacity-70">Ollama Endpoint Address</label>
                            <div className="flex items-center gap-2">
                              <span
                                className={`h-2.5 w-2.5 rounded-full ${
                                  ollamaConnectionState === "ok"
                                    ? "bg-emerald-500"
                                    : ollamaConnectionState === "fail"
                                      ? "bg-red-500"
                                      : "bg-zinc-500"
                                }`}
                                title={ollamaConnectionState === "ok" ? "Connected" : ollamaConnectionState === "fail" ? "Connection failed" : "Not tested"}
                              />
                              <button
                                type="button"
                                onClick={() => void testOllamaConnection(settings.ollamaAddress)}
                                disabled={isTestingOllama}
                                className={`rounded-lg border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest transition-colors ${
                                  isDarkMode
                                    ? "border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                                    : "border-zinc-300 bg-zinc-150 text-zinc-700 hover:bg-zinc-200"
                                } disabled:opacity-50`}
                              >
                                {isTestingOllama ? "Testing..." : "Test Connection"}
                              </button>
                            </div>
                          </div>
                          <input
                            type="text"
                            placeholder="http://127.0.0.1:11434"
                            value={settings.ollamaAddress}
                            onChange={(e) => {
                              const val = e.target.value;
                              setSettings((s) => ({ ...s, ollamaAddress: val }));
                              setOllamaConnectionState("unknown");
                              saveSetting("ollamaAddress", val);
                            }}
                            className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none ${
                              isDarkMode
                                ? "border-zinc-700 bg-zinc-800 text-zinc-100 placeholder-zinc-600"
                                : "border-zinc-300 bg-zinc-200 text-zinc-900 placeholder-zinc-500"
                            }`}
                          />
                        </div>
                        <div>
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <label className="text-xs font-medium opacity-70">Ollama LLM Model</label>
                            <button
                              type="button"
                              onClick={() => void refreshOllamaModels(settings.ollamaAddress, settings.ollamaModel)}
                              disabled={isRefreshingModels}
                              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest transition-colors ${
                                isDarkMode
                                  ? "border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                                  : "border-zinc-300 bg-zinc-150 text-zinc-700 hover:bg-zinc-200"
                              } disabled:opacity-50`}
                            >
                              <RefreshCw size={12} className={isRefreshingModels ? "animate-spin" : ""} />
                              Refresh
                            </button>
                          </div>
                          <select
                            value={settings.ollamaModel}
                            onChange={(e) => {
                              const val = e.target.value;
                              setSettings((s) => ({ ...s, ollamaModel: val }));
                              saveSetting("ollamaModel", val);
                            }}
                            className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none ${
                              isDarkMode
                                ? "border-zinc-700 bg-zinc-800 text-zinc-100"
                                : "border-zinc-300 bg-zinc-200 text-zinc-900"
                            }`}
                          >
                            {ollamaModels.length === 0 ? (
                              <option value={settings.ollamaModel}>{settings.ollamaModel || "No models found"}</option>
                            ) : (
                              ollamaModels.map((model) => (
                                <option key={`provider-${model}`} value={model}>{model}</option>
                              ))
                            )}
                          </select>
                          <p className={`mt-2 text-[11px] ${isDarkMode ? "text-zinc-400" : "text-zinc-500"}`}>
                            Small model like Qwen2.5:3b would work.
                          </p>
                        </div>
                      </>
                    )}

                    {settings.llmProvider === "openai" && (
                      <>
                        <div>
                          <label className="mb-1.5 block text-xs font-medium opacity-70">OpenAI API Key</label>
                          <input
                            type="password"
                            placeholder="sk-..."
                            value={settings.openaiApiKey}
                            onChange={(e) => {
                              const val = e.target.value;
                              setSettings((s) => ({ ...s, openaiApiKey: val }));
                              saveSetting("openaiApiKey", val);
                            }}
                            className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none ${
                              isDarkMode
                                ? "border-zinc-700 bg-zinc-800 text-zinc-100 placeholder-zinc-600"
                                : "border-zinc-300 bg-zinc-200 text-zinc-900 placeholder-zinc-500"
                            }`}
                          />
                        </div>
                        <div>
                          <label className="mb-1.5 block text-xs font-medium opacity-70">OpenAI Model</label>
                          <select
                            value={settings.openaiModel}
                            onChange={(e) => {
                              const val = e.target.value;
                              setSettings((s) => ({ ...s, openaiModel: val }));
                              saveSetting("openaiModel", val);
                            }}
                            className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none ${
                              isDarkMode
                                ? "border-zinc-700 bg-zinc-800 text-zinc-100"
                                : "border-zinc-300 bg-zinc-200 text-zinc-900"
                            }`}
                          >
                            {OPENAI_MODELS.map((model) => (
                              <option key={model} value={model}>{model}</option>
                            ))}
                          </select>
                        </div>
                      </>
                    )}

                    {settings.llmProvider === "claude" && (
                      <>
                        <div>
                          <label className="mb-1.5 block text-xs font-medium opacity-70">Claude API Key</label>
                          <input
                            type="password"
                            placeholder="sk-ant-..."
                            value={settings.claudeApiKey}
                            onChange={(e) => {
                              const val = e.target.value;
                              setSettings((s) => ({ ...s, claudeApiKey: val }));
                              saveSetting("claudeApiKey", val);
                            }}
                            className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none ${
                              isDarkMode
                                ? "border-zinc-700 bg-zinc-800 text-zinc-100 placeholder-zinc-600"
                                : "border-zinc-300 bg-zinc-200 text-zinc-900 placeholder-zinc-500"
                            }`}
                          />
                        </div>
                        <div>
                          <label className="mb-1.5 block text-xs font-medium opacity-70">Claude Model</label>
                          <select
                            value={settings.claudeModel}
                            onChange={(e) => {
                              const val = e.target.value;
                              setSettings((s) => ({ ...s, claudeModel: val }));
                              saveSetting("claudeModel", val);
                            }}
                            className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none ${
                              isDarkMode
                                ? "border-zinc-700 bg-zinc-800 text-zinc-100"
                                : "border-zinc-300 bg-zinc-200 text-zinc-900"
                            }`}
                          >
                            {CLAUDE_MODELS.map((model) => (
                              <option key={model} value={model}>{model}</option>
                            ))}
                          </select>
                        </div>
                      </>
                    )}

                    {settings.llmProvider === "gemini" && (
                      <>
                        <div>
                          <label className="mb-1.5 block text-xs font-medium opacity-70">Google Gemini API Key</label>
                          <input
                            type="password"
                            placeholder="AIza..."
                            value={settings.geminiApiKey}
                            onChange={(e) => {
                              const val = e.target.value;
                              setSettings((s) => ({ ...s, geminiApiKey: val }));
                              saveSetting("geminiApiKey", val);
                            }}
                            className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none ${
                              isDarkMode
                                ? "border-zinc-700 bg-zinc-800 text-zinc-100 placeholder-zinc-600"
                                : "border-zinc-300 bg-zinc-200 text-zinc-900 placeholder-zinc-500"
                            }`}
                          />
                        </div>
                        <div>
                          <label className="mb-1.5 block text-xs font-medium opacity-70">Gemini Model</label>
                          <select
                            value={settings.geminiModel}
                            onChange={(e) => {
                              const val = e.target.value;
                              setSettings((s) => ({ ...s, geminiModel: val }));
                              saveSetting("geminiModel", val);
                            }}
                            className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none ${
                              isDarkMode
                                ? "border-zinc-700 bg-zinc-800 text-zinc-100"
                                : "border-zinc-300 bg-zinc-200 text-zinc-900"
                            }`}
                          >
                            {GEMINI_MODELS.map((model) => (
                              <option key={model} value={model}>{model}</option>
                            ))}
                          </select>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div>
            <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-red-500">Danger Zone</p>
            <div className={`rounded-xl border border-red-500/30 p-4 ${isDarkMode ? "bg-red-950/20" : "bg-red-50"}`}>
              <p className="mb-1 text-sm font-semibold">Clean Reset</p>
              <p className={`mb-4 text-xs ${isDarkMode ? "text-zinc-400" : "text-zinc-500"}`}>
                Permanently deletes articles, cached thumbnails, and settings, then recreates a fresh default setup. Downloaded embedding models and default RSS feeds are preserved. This cannot be undone.
              </p>

              {purgeConfirmStep === 0 && (
                <button
                  type="button"
                  onClick={() => setPurgeConfirmStep(1)}
                  className="rounded-lg bg-red-600 px-4 py-2 text-xs font-bold uppercase tracking-widest text-white transition-colors hover:bg-red-700"
                >
                  Clean Reset
                </button>
              )}

              {purgeConfirmStep === 1 && (
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-red-500">Are you sure? All data will be lost.</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setPurgeConfirmStep(2)}
                      className="rounded-lg bg-red-600 px-4 py-2 text-xs font-bold uppercase tracking-widest text-white transition-colors hover:bg-red-700"
                    >
                      Yes, continue
                    </button>
                    <button
                      type="button"
                      onClick={() => setPurgeConfirmStep(0)}
                      className={`rounded-lg border px-4 py-2 text-xs font-bold uppercase tracking-widest transition-colors ${
                        isDarkMode
                          ? "border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                          : "border-zinc-300 bg-zinc-150 text-zinc-700 hover:bg-zinc-200"
                      }`}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {purgeConfirmStep === 2 && (
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-red-500">Final confirmation — this will delete everything permanently.</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={isPurging}
                      onClick={async () => {
                        setIsPurging(true);
                        try {
                          await onPurgeDatabase();
                        } catch (err) {
                          console.error("Purge failed:", err);
                        } finally {
                          setIsPurging(false);
                          setPurgeConfirmStep(0);
                          onClose();
                        }
                      }}
                      className="rounded-lg bg-red-600 px-4 py-2 text-xs font-bold uppercase tracking-widest text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                    >
                      {isPurging ? "Resetting..." : "Yes, clean reset"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPurgeConfirmStep(0)}
                      disabled={isPurging}
                      className={`rounded-lg border px-4 py-2 text-xs font-bold uppercase tracking-widest transition-colors ${
                        isDarkMode
                          ? "border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                          : "border-zinc-300 bg-zinc-150 text-zinc-700 hover:bg-zinc-200"
                      } disabled:opacity-50`}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
