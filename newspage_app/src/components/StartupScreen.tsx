import { useTranslation } from "react-i18next";
import { DotsSpinner } from "./DotsSpinner";
import type { LocalEmbeddingStatus } from "../types/article";

const LOADING_STEP_KEYS = ["articles", "scoring", "feeds", "cloudModels"] as const;
export type LoadingDataStep = (typeof LOADING_STEP_KEYS)[number] | "";

interface StartupScreenProps {
  isDarkMode: boolean;
  startupPhase: "loading-settings" | "preparing-embedding" | "loading-data" | "ready" | "error";
  startupErrorMessage: string;
  localEmbeddingStatus: LocalEmbeddingStatus | null;
  settingsLocalEmbeddingModel: string;
  loadingDataStep?: LoadingDataStep;
  onRetry: () => void;
  onCleanReset: () => void;
}

export function StartupScreen({
  isDarkMode,
  startupPhase,
  startupErrorMessage,
  localEmbeddingStatus,
  settingsLocalEmbeddingModel,
  loadingDataStep,
  onRetry,
  onCleanReset,
}: StartupScreenProps) {
  const { t } = useTranslation();

  const phaseMessage = startupPhase === "loading-settings"
    ? t("startup.loadingSettings")
    : startupPhase === "preparing-embedding"
      ? t("startup.loadingModel", { model: settingsLocalEmbeddingModel })
      : startupPhase === "loading-data"
        ? getLoadingStepMessage(t, loadingDataStep ?? "")
        : startupErrorMessage;

  return (
    <div className={`min-h-screen ${isDarkMode ? "bg-zinc-950 text-zinc-200" : "bg-white text-zinc-900"} flex items-center justify-center p-6`}>
      <div className={`w-full max-w-lg rounded-3xl border p-8 shadow-2xl ${isDarkMode ? "border-zinc-800 bg-zinc-900" : "border-zinc-200 bg-zinc-50"}`}>
        <p className={`mb-2 text-[10px] font-bold uppercase tracking-widest ${isDarkMode ? "text-zinc-500" : "text-zinc-500"}`}>
          {startupPhase === "error" ? t("startup.embeddingLoadFailed") : t("startup.starting")}
        </p>
        <h1 className={`mb-3 text-2xl font-black ${isDarkMode ? "text-zinc-100" : "text-zinc-900"}`}>
          {startupPhase === "error" ? t("startup.embeddingFailed") : t("startup.preparing")}
        </h1>
        <p className={`text-sm leading-relaxed ${isDarkMode ? "text-zinc-300" : "text-zinc-700"}`}>
          {phaseMessage}
        </p>
        {localEmbeddingStatus?.message && startupPhase !== "error" && startupPhase !== "loading-data" ? (
          <p className={`mt-3 text-xs ${isDarkMode ? "text-zinc-500" : "text-zinc-500"}`}>
            {localEmbeddingStatus.message}
          </p>
        ) : null}
        {startupPhase !== "error" ? (
          <DotsSpinner size={32} className="mt-6 text-zinc-500" />
        ) : (
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={onRetry}
              className={`rounded-lg border px-4 py-2 text-xs font-bold uppercase tracking-widest transition-colors ${
                isDarkMode ? "border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700" : "border-zinc-300 bg-zinc-200 text-zinc-700 hover:bg-zinc-300"
              }`}
            >
              {t("startup.retryLoad")}
            </button>
            <button
              type="button"
              onClick={onCleanReset}
              className="rounded-lg bg-red-600 px-4 py-2 text-xs font-bold uppercase tracking-widest text-white transition-colors hover:bg-red-700"
            >
              {t("startup.cleanReset")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function getLoadingStepMessage(t: (key: string) => string, step: string): string {
  switch (step) {
    case "articles": return t("startup.loadingArticles");
    case "scoring": return t("startup.calculatingScores");
    case "feeds": return t("startup.loadingFeeds");
    case "cloudModels": return t("startup.fetchingModels");
    default: return t("startup.loadingData");
  }
}
