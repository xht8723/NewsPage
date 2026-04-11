import type React from "react";
import { RefreshCw } from "lucide-react";
import type { UserSettings } from "../types/article";

interface LLMProviderSectionProps {
  label: string;
  apiKeyLabel: string;
  apiKeyPlaceholder: string;
  apiKey: string;
  apiKeySettingKey: keyof UserSettings;
  modelName: string;
  modelSettingKey: keyof UserSettings;
  providerId: string;
  isDarkMode: boolean;
  cloudModels: Record<string, string[]>;
  onRefreshModels: (provider: string) => void;
  setSettings: (updater: (prev: UserSettings) => UserSettings) => void;
  saveSetting: (key: string, value: string) => void;
}

export function LLMProviderSection({
  label,
  apiKeyLabel,
  apiKeyPlaceholder,
  apiKey,
  apiKeySettingKey,
  modelName,
  modelSettingKey,
  providerId,
  isDarkMode,
  cloudModels,
  onRefreshModels,
  setSettings,
  saveSetting,
}: LLMProviderSectionProps): React.JSX.Element {
  const models = cloudModels[providerId] || [];

  return (
    <>
      <div>
        <label className="mb-1.5 block text-xs font-medium opacity-70">{apiKeyLabel}</label>
        <input
          type="password"
          placeholder={apiKeyPlaceholder}
          value={apiKey}
          onChange={(e) => {
            const val = e.target.value;
            setSettings((s) => ({ ...s, [apiKeySettingKey]: val }));
            saveSetting(apiKeySettingKey as string, val);
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
          <label className="text-xs font-medium opacity-70">{label} Model</label>
          <button
            type="button"
            onClick={() => void onRefreshModels(providerId)}
            className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest transition-colors ${
              isDarkMode
                ? "border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                : "border-zinc-300 bg-zinc-150 text-zinc-700 hover:bg-zinc-200"
            } disabled:opacity-50`}
          >
            <RefreshCw size={12} />
            Refresh
          </button>
        </div>
        <select
          value={modelName}
          onChange={(e) => {
            const val = e.target.value;
            setSettings((s) => ({ ...s, [modelSettingKey]: val }));
            saveSetting(modelSettingKey as string, val);
          }}
          className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none ${
            isDarkMode
              ? "border-zinc-700 bg-zinc-800 text-zinc-100"
              : "border-zinc-300 bg-zinc-200 text-zinc-900"
          }`}
        >
          {models.length === 0 ? (
            <option value={modelName}>{modelName}</option>
          ) : (
            models.map((model) => (
              <option key={model} value={model}>{model}</option>
            ))
          )}
        </select>
      </div>
    </>
  );
}
