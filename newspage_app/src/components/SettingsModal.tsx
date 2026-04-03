import { invoke } from "@tauri-apps/api/core";
import { FolderOpen, RefreshCw, Settings, X } from "lucide-react";
import type React from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  AVAILABLE_REGIONS,
  CLAUDE_MODELS,
  EMBEDDING_MODEL_INFO,
  GEMINI_MODELS,
  OPENAI_MODELS,
  type OllamaConnectionState,
} from "../constants/news";
import type { LocalEmbeddingStatus, UserSettings } from "../types/news";

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
  isEmbeddingReady: boolean;
  isEmbeddingConfigured: boolean;
  purgeConfirmStep: 0 | 1 | 2;
  setPurgeConfirmStep: Dispatch<SetStateAction<0 | 1 | 2>>;
  isPurging: boolean;
  setIsPurging: Dispatch<SetStateAction<boolean>>;
  onPurgeDatabase: () => Promise<void>;
  onOpenSourceBlacklistManager: () => void;
  onOpenCategoryLimits: () => void;
  onClose: () => void;
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
  onOpenSourceBlacklistManager,
  onOpenCategoryLimits,
  onClose,
}: SettingsModalProps): React.JSX.Element | null {
  if (!showSettings) {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className={`relative w-full max-w-6xl overflow-hidden rounded-3xl border shadow-2xl ${
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
        <div className={`max-h-[calc(100vh-10rem)] space-y-6 overflow-y-auto p-6 news-scroll ${isDarkMode ? "news-scroll-dark" : "news-scroll-light"}`}>
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-10">
              <div className={`order-2 rounded-xl border p-4 lg:order-1 lg:col-span-7 ${isDarkMode ? "border-zinc-800 bg-zinc-950/40" : "border-zinc-200 bg-zinc-150"}`}>
                <p className={`mb-3 text-[10px] font-bold uppercase tracking-widest ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>General Settings</p>
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
                        className={`number-dial-${isDarkMode ? "dark" : "light"} flex-1 rounded-lg border px-3 py-2 text-sm font-semibold focus:outline-none ${
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
                    <input
                      type="number"
                      min={0}
                      max={24}
                      value={settings.scrapeCooldownHours}
                      onChange={(e) => {
                        const val = Math.min(24, Math.max(0, Number(e.target.value)));
                        setSettings((s) => ({ ...s, scrapeCooldownHours: val }));
                        saveSetting("scrapeCooldownHours", String(val));
                      }}
                      className={`number-dial-${isDarkMode ? "dark" : "light"} w-full rounded-lg border px-3 py-2 text-sm font-semibold focus:outline-none ${
                        isDarkMode
                          ? "border-zinc-700 bg-zinc-800 text-zinc-100"
                          : "border-zinc-300 bg-zinc-200 text-zinc-900"
                      }`}
                    />
                  </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-medium opacity-70">LLM batch size</label>
                      <p className="mb-1.5 text-xs opacity-50">How many articles for the LLM to process in a single batch.</p>
                      <input
                        type="number"
                        min={1}
                        max={20}
                        value={settings.llmBatchSize}
                        onChange={(e) => {
                          const val = Math.min(20, Math.max(1, Number(e.target.value)));
                          setSettings((s) => ({ ...s, llmBatchSize: val }));
                          saveSetting("llmBatchSize", String(val));
                        }}
                        className={`number-dial-${isDarkMode ? "dark" : "light"} w-full rounded-lg border px-3 py-2 text-sm font-semibold focus:outline-none ${
                          isDarkMode
                            ? "border-zinc-700 bg-zinc-800 text-zinc-100"
                            : "border-zinc-300 bg-zinc-200 text-zinc-900"
                        }`}
                      />
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

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className={`rounded-xl border p-4 ${isDarkMode ? "border-zinc-800 bg-zinc-950/40" : "border-zinc-200 bg-zinc-150"}`}>
                <p className={`mb-3 text-[10px] font-bold uppercase tracking-widest ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>News Regions</p>
                <p className={`mb-3 text-xs ${isDarkMode ? "text-zinc-400" : "text-zinc-500"}`}>Select regions for news source</p>
                <div className="space-y-2">
                  {AVAILABLE_REGIONS.map((region) => {
                    const checked = settings.selectedRegions.includes(region.id);
                    return (
                      <label key={region.id} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            const next = checked
                              ? settings.selectedRegions.filter((r) => r !== region.id)
                              : [...settings.selectedRegions, region.id];
                            setSettings((s) => ({ ...s, selectedRegions: next }));
                            saveSetting("selectedRegions", JSON.stringify(next));
                          }}
                          className={`h-4 w-4 rounded border transition-colors ${
                            isDarkMode
                              ? "border-zinc-500 bg-zinc-800 accent-cyan-600"
                              : "border-zinc-400 bg-white accent-emerald-500"
                          }`}
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

              <div className={`rounded-xl border p-4 ${isDarkMode ? "border-zinc-800 bg-zinc-950/40" : "border-zinc-200 bg-zinc-150"}`}>
                <p className={`mb-3 text-[10px] font-bold uppercase tracking-widest ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>Source Blacklist</p>
                <p className={`mb-3 text-xs ${isDarkMode ? "text-zinc-400" : "text-zinc-500"}`}>
                  Blacklisted sources are skipped and hidden in future queries.
                </p>
                <button
                  type="button"
                  onClick={onOpenSourceBlacklistManager}
                  className={`rounded-lg border px-3 py-2 text-xs font-bold uppercase tracking-widest transition-colors ${
                    isDarkMode
                      ? "border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                      : "border-zinc-300 bg-zinc-200 text-zinc-700 hover:bg-zinc-300"
                  }`}
                >
                  Manage Blacklist ({settings.sourceBlacklist.length})
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className={`rounded-xl border p-4 ${isDarkMode ? "border-zinc-800 bg-zinc-950/40" : "border-zinc-200 bg-zinc-150"}`}>
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
                        } shrink-0 disabled:opacity-50`}
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
                      <div className={`mt-3 overflow-hidden rounded-full border ${isDarkMode ? "border-zinc-700" : "border-zinc-300"}`}>
                        <div className={`h-2 w-full animate-pulse ${isDarkMode ? "bg-emerald-500/70" : "bg-emerald-500"}`} />
                      </div>
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

              <div className={`rounded-xl border p-4 ${isDarkMode ? "border-zinc-800 bg-zinc-950/40" : "border-zinc-200 bg-zinc-150"}`}>
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
            </div>
          </div>

          <div>
            <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-red-500">Danger Zone</p>
            <div className={`rounded-xl border border-red-500/30 p-4 ${isDarkMode ? "bg-red-950/20" : "bg-red-50"}`}>
              <p className="mb-1 text-sm font-semibold">Clean Reset</p>
              <p className={`mb-4 text-xs ${isDarkMode ? "text-zinc-400" : "text-zinc-500"}`}>
                Permanently deletes articles, cached thumbnails, embedding models, and settings, then recreates a fresh default setup. This cannot be undone.
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
