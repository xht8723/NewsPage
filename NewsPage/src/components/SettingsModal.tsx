import { RefreshCw, Settings, X } from "lucide-react";
import type React from "react";
import type { Dispatch, SetStateAction } from "react";
import {
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
  localEmbeddingStatus: LocalEmbeddingStatus | null;
  isPreparingLocalEmbeddingModel: boolean;
  onPrepareLocalEmbeddingModel: (model: string) => Promise<void>;
  embeddingInitialized: boolean;
  embeddingModelLocked: boolean;
  purgeConfirmStep: 0 | 1 | 2;
  setPurgeConfirmStep: Dispatch<SetStateAction<0 | 1 | 2>>;
  isPurging: boolean;
  setIsPurging: Dispatch<SetStateAction<boolean>>;
  onPurgeDatabase: () => Promise<void>;
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
  localEmbeddingStatus,
  isPreparingLocalEmbeddingModel,
  onPrepareLocalEmbeddingModel,
  embeddingInitialized,
  embeddingModelLocked,
  purgeConfirmStep,
  setPurgeConfirmStep,
  isPurging,
  setIsPurging,
  onPurgeDatabase,
  onClose,
}: SettingsModalProps): React.JSX.Element | null {
  if (!showSettings) {
    return null;
  }

  const embeddingIsBusy = isPreparingLocalEmbeddingModel || localEmbeddingStatus?.state === "downloading";
  const embeddingSelectionLocked = embeddingInitialized && embeddingModelLocked;
  const selectedModelReady =
    localEmbeddingStatus?.state === "ready" &&
    (localEmbeddingStatus.active_model ?? "").toLowerCase() === settings.localEmbeddingModel.toLowerCase();
  const downloadButtonDisabled = embeddingIsBusy || selectedModelReady;
  const embeddingModelTooltip = embeddingSelectionLocked
    ? "Embedding model is locked after first successful setup to keep relevance sorting consistent. Purge Database in Danger Zone to unlock."
    : "Select the local embedding model used for relevance sorting.";

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
        <div className="max-h-[calc(100vh-10rem)] space-y-6 overflow-y-auto p-6">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className={`rounded-xl border p-4 ${isDarkMode ? "border-zinc-800 bg-zinc-950/40" : "border-zinc-200 bg-zinc-150"}`}>
              <p className={`mb-3 text-[10px] font-bold uppercase tracking-widest ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>General Settings</p>
              <div className="space-y-3">
                <div>
                  <label className="mb-1.5 block text-xs font-medium opacity-70">Number of news per pull</label>
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
                    className={`w-full rounded-lg border px-3 py-2 text-sm font-semibold focus:outline-none ${
                      isDarkMode
                        ? "border-zinc-700 bg-zinc-800 text-zinc-100"
                        : "border-zinc-300 bg-zinc-200 text-zinc-900"
                    }`}
                  />
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
                    className={`w-full rounded-lg border px-3 py-2 text-sm font-semibold focus:outline-none ${
                      isDarkMode
                        ? "border-zinc-700 bg-zinc-800 text-zinc-100"
                        : "border-zinc-300 bg-zinc-200 text-zinc-900"
                    }`}
                  />
                </div>
              </div>
            </div>

            <div className={`rounded-xl border p-4 ${isDarkMode ? "border-zinc-800 bg-zinc-950/40" : "border-zinc-200 bg-zinc-150"}`}>
              <p className={`mb-3 text-[10px] font-bold uppercase tracking-widest ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>Embedding Settings</p>
              <div className="space-y-3">
                <div>
                  <label className="mb-1.5 block text-xs font-medium opacity-70">Local Embedding Model (Relevance)</label>
                  <select
                    value={settings.localEmbeddingModel}
                    disabled={embeddingSelectionLocked}
                    title={embeddingModelTooltip}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSettings((s) => ({ ...s, localEmbeddingModel: val }));
                      saveSetting("localEmbeddingModel", val);
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
                    {localEmbeddingModels.length === 0 && <option value={settings.localEmbeddingModel}>{settings.localEmbeddingModel}</option>}
                  </select>
                  {!embeddingSelectionLocked && (
                    <p className={`mt-2 text-[11px] ${isDarkMode ? "text-zinc-400" : "text-zinc-500"}`}>
                      {!embeddingInitialized
                        ? "First launch setup: choose your embedding model and click Download Model."
                        : "Embedding model selection is unlocked."}
                    </p>
                  )}
                  <div className="mt-2 flex items-start justify-end">
                    <button
                      type="button"
                      disabled={downloadButtonDisabled}
                      onClick={() => void onPrepareLocalEmbeddingModel(settings.localEmbeddingModel)}
                      className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest transition-colors ${
                        isDarkMode
                          ? `border-zinc-700 bg-zinc-800 text-zinc-200 ${downloadButtonDisabled ? "" : "hover:bg-zinc-700"}`
                          : `border-zinc-300 bg-zinc-150 text-zinc-700 ${downloadButtonDisabled ? "" : "hover:bg-zinc-200"}`
                      } shrink-0 disabled:opacity-50`}
                    >
                      <RefreshCw size={12} className={embeddingIsBusy ? "animate-spin" : ""} />
                      {embeddingIsBusy ? "Downloading..." : selectedModelReady ? "Downloaded" : "Download Model"}
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

          <div className={`rounded-xl border p-4 ${isDarkMode ? "border-zinc-800 bg-zinc-950/40" : "border-zinc-200 bg-zinc-150"}`}>
            <p className={`mb-3 text-[10px] font-bold uppercase tracking-widest ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>Serp API Key</p>
            <input
              type="password"
              placeholder="Enter your SerpAPI key..."
              value={settings.serpApiKey}
              onChange={(e) => {
                const val = e.target.value;
                setSettings((s) => ({ ...s, serpApiKey: val }));
                saveSetting("serpApiKey", val);
              }}
              className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none ${
                isDarkMode
                  ? "border-zinc-700 bg-zinc-800 text-zinc-100 placeholder-zinc-600"
                  : "border-zinc-300 bg-zinc-200 text-zinc-900 placeholder-zinc-500"
              }`}
            />
          </div>

          <div>
            <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-red-500">Danger Zone</p>
            <div className={`rounded-xl border border-red-500/30 p-4 ${isDarkMode ? "bg-red-950/20" : "bg-red-50"}`}>
              <p className="mb-1 text-sm font-semibold">Purge Database</p>
              <p className={`mb-4 text-xs ${isDarkMode ? "text-zinc-400" : "text-zinc-500"}`}>
                Permanently deletes all news articles and cached thumbnails. This cannot be undone. It also unlocks embedding model selection.
              </p>

              {purgeConfirmStep === 0 && (
                <button
                  type="button"
                  onClick={() => setPurgeConfirmStep(1)}
                  className="rounded-lg bg-red-600 px-4 py-2 text-xs font-bold uppercase tracking-widest text-white transition-colors hover:bg-red-700"
                >
                  Purge Database
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
                      {isPurging ? "Purging..." : "Yes, delete everything"}
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
