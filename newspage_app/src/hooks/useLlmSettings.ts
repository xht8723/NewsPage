import { useCallback, useEffect, useRef, useState } from "react";
import { LOCAL_EMBEDDING_MODELS, type OllamaConnectionState } from "../constants/article";
import type { LocalEmbeddingStatus, UserSettings } from "../types/article";
import { llmService, settingsService } from "../services";
import { useSettingsStore } from "../stores/settingsStore";

interface UseLlmSettingsReturn {
  ollamaConnectionState: OllamaConnectionState;
  setOllamaConnectionState: (state: OllamaConnectionState) => void;
  isTestingOllama: boolean;
  ollamaModels: string[];
  isRefreshingModels: boolean;
  testOllamaConnection: (address: string) => Promise<void>;
  refreshOllamaModels: (address: string, preferredModel?: string) => Promise<void>;
  localEmbeddingModels: string[];
  setLocalEmbeddingModels: (models: string[]) => void;
  localEmbeddingStatus: LocalEmbeddingStatus | null;
  setLocalEmbeddingStatus: (status: LocalEmbeddingStatus | null) => void;
  isPreparingLocalEmbeddingModel: boolean;
  prepareLocalEmbeddingModel: (model: string) => Promise<void>;
  refreshLocalEmbeddingStatus: () => Promise<LocalEmbeddingStatus | null>;
  cloudModels: Record<string, string[]>;
  refreshCloudModels: (provider: string) => Promise<void>;
}

export function useLlmSettings(deps: {
  startupPhase: string;
  disableRelevanceSort: (reason: string) => void;
}): UseLlmSettingsReturn {
  const settings = useSettingsStore((s) => s.settings);
  const setSettings = useSettingsStore((s) => s.setSettings);
  const saveSetting = useSettingsStore((s) => s.saveSetting);
  const setIsEmbeddingReady = useSettingsStore((s) => s.setIsEmbeddingReady);

  const [ollamaConnectionState, setOllamaConnectionState] = useState<OllamaConnectionState>("unknown");
  const [isTestingOllama, setIsTestingOllama] = useState(false);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [isRefreshingModels, setIsRefreshingModels] = useState(false);
  const [localEmbeddingModels, setLocalEmbeddingModels] = useState<string[]>(
    [...LOCAL_EMBEDDING_MODELS],
  );
  const [localEmbeddingStatus, setLocalEmbeddingStatus] = useState<LocalEmbeddingStatus | null>(null);
  const [isPreparingLocalEmbeddingModel, setIsPreparingLocalEmbeddingModel] = useState(false);
  const [cloudModels, setCloudModels] = useState<Record<string, string[]>>({});

  const disableRelevanceSort = deps.disableRelevanceSort;

  const testOllamaConnection = useCallback(async (address: string) => {
    setIsTestingOllama(true);
    try {
      await llmService.testOllamaConnection(address);
      setOllamaConnectionState("ok");
    } catch {
      setOllamaConnectionState("fail");
      disableRelevanceSort("Ollama connection test failed");
    } finally {
      setIsTestingOllama(false);
    }
  }, [disableRelevanceSort]);

  const refreshOllamaModels = useCallback(async (address: string, preferredModel?: string) => {
    setIsRefreshingModels(true);
    try {
      const models = await llmService.listOllamaModels(address);
      setOllamaModels(models);
      setOllamaConnectionState("ok");
      if (models.length === 0) {
        return;
      }

      const candidate = preferredModel ?? models[0];
      const nextModel = models.includes(candidate) ? candidate : models[0];
      setSettings((s) => {
        if (s.ollamaModel === nextModel) {
          return s;
        }
        saveSetting("ollamaModel", nextModel);
        return { ...s, ollamaModel: nextModel };
      });
    } catch {
      setOllamaConnectionState("fail");
      setOllamaModels([]);
      disableRelevanceSort("Ollama model refresh failed");
    } finally {
      setIsRefreshingModels(false);
    }
  }, [disableRelevanceSort, saveSetting, setSettings]);

  const refreshLocalEmbeddingStatus = useCallback(async (): Promise<LocalEmbeddingStatus | null> => {
    try {
      const status = await llmService.getLocalEmbeddingStatus();
      setLocalEmbeddingStatus(status);
      const configuredModel = settings.localEmbeddingModel.trim().toLowerCase();
      const ready =
        status.state === "ready" &&
        (status.active_model ?? "").toLowerCase() === configuredModel;
      setIsEmbeddingReady(ready);
      return status;
    } catch {
      return null;
    }
  }, [settings.localEmbeddingModel, setIsEmbeddingReady]);

  const prepareLocalEmbeddingModel = useCallback(async (model: string) => {
    setIsPreparingLocalEmbeddingModel(true);
    try {
      const status = await llmService.prepareLocalEmbeddingModel(model);
      setLocalEmbeddingStatus(status);
      const ready =
        status.state === "ready"
        && (status.active_model ?? "").toLowerCase() === model.trim().toLowerCase();
      if (ready) {
        setIsEmbeddingReady(true);
        setSettings((current) => ({
          ...current,
          localEmbeddingModel: model,
          embeddingInitialized: true,
          embeddingModelLocked: true,
        }));
        await settingsService.save("localEmbeddingModel", model);
      } else {
        throw new Error(status.message || `Failed to prepare embedding model '${model}'.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLocalEmbeddingStatus((current) => ({
        state: "error",
        active_model: model,
        cache_dir: current?.cache_dir ?? "",
        message,
      }));
      setIsEmbeddingReady(false);
    } finally {
      setIsPreparingLocalEmbeddingModel(false);
    }
  }, [setSettings, setIsEmbeddingReady]);

  const refreshCloudModels = useCallback(async (provider: string) => {
    try {
      const models = await llmService.listCloudModels(provider);
      setCloudModels((prev) => ({ ...prev, [provider]: models }));
      const modelKey = `${provider}Model` as keyof UserSettings;
      const currentModel = settings[modelKey] as string;
      if (currentModel && !models.includes(currentModel) && models.length > 0) {
        const nextModel = models[0];
        setSettings((s) => ({ ...s, [modelKey]: nextModel }));
        saveSetting(modelKey as string, nextModel);
      }
    } catch (_e) {
    }
  }, [settings, saveSetting, setSettings]);

  const initialCloudFetchDone = useRef(false);
  useEffect(() => {
    if (initialCloudFetchDone.current) return;
    if (deps.startupPhase === "loading-settings") return;
    initialCloudFetchDone.current = true;
    for (const p of ["openai", "claude", "gemini", "deepseek"]) {
      void refreshCloudModels(p);
    }
  }, [deps.startupPhase, refreshCloudModels]);

  return {
    ollamaConnectionState,
    setOllamaConnectionState,
    isTestingOllama,
    ollamaModels,
    isRefreshingModels,
    testOllamaConnection,
    refreshOllamaModels,
    localEmbeddingModels,
    setLocalEmbeddingModels,
    localEmbeddingStatus,
    setLocalEmbeddingStatus,
    isPreparingLocalEmbeddingModel,
    prepareLocalEmbeddingModel,
    refreshLocalEmbeddingStatus,
    cloudModels,
    refreshCloudModels,
  };
}
