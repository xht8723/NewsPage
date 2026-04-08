import { useCallback, useEffect, useState } from "react";
import { useSettingsStore } from "../stores";
import type { UserSettings } from "../types/news";
import type { OllamaConnectionState } from "../constants/news";
import { LOCAL_EMBEDDING_MODELS, DEFAULT_EMBEDDING_MODEL } from "../constants/news";
import { llmService, settingsService } from "../services";

interface EmbeddingStatus {
  isReady: boolean;
  isPreparing: boolean;
  status: {
    state: string;
    active_model: string | null;
    cache_dir: string;
    message: string;
  } | null;
}

export function useSettingsManager() {
  const { settings, setSettings, isLoaded, loadSettings } = useSettingsStore();
  const [ollamaConnectionState, setOllamaConnectionState] = useState<OllamaConnectionState>("unknown");
  const [isTestingOllama, setIsTestingOllama] = useState(false);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [isRefreshingModels, setIsRefreshingModels] = useState(false);
  const [localEmbeddingModels, setLocalEmbeddingModels] = useState<string[]>(LOCAL_EMBEDDING_MODELS as unknown as string[]);
  const [localEmbeddingStatus, setLocalEmbeddingStatus] = useState<EmbeddingStatus["status"]>(null);
  const [isPreparingLocalEmbeddingModel, setIsPreparingLocalEmbeddingModel] = useState(false);
  const [selectedEmbeddingModel, setSelectedEmbeddingModel] = useState(DEFAULT_EMBEDDING_MODEL);
  const [startupPhase, setStartupPhase] = useState<"loading-settings" | "preparing-embedding" | "ready" | "error">("loading-settings");
  const [startupErrorMessage, setStartupErrorMessage] = useState("");

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (!isLoaded) return;

    const savedModel = settings.localEmbeddingModel.trim();
    if (savedModel) {
      setSelectedEmbeddingModel(savedModel);
      setStartupPhase("preparing-embedding");
      void prepareEmbeddingOnStartup(savedModel);
    } else {
      setStartupPhase("ready");
    }
  }, [isLoaded, settings.localEmbeddingModel]);

  const prepareEmbeddingOnStartup = useCallback(async (model: string) => {
    const normalizedModel = model.trim().toLowerCase();
    if (!normalizedModel) {
      setStartupPhase("ready");
      return;
    }

    setStartupPhase("preparing-embedding");
    setStartupErrorMessage("");

    try {
      const status = await llmService.prepareLocalEmbeddingModel(model);
      setLocalEmbeddingStatus(status);

      const ready =
        status.state === "ready" &&
        (status.active_model ?? "").toLowerCase() === normalizedModel;

      if (!ready) {
        throw new Error(status.message || `Failed to load embedding model '${model}'.`);
      }

      setStartupPhase("ready");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLocalEmbeddingStatus({
        state: "error",
        active_model: model,
        cache_dir: "",
        message,
      });
      setStartupErrorMessage(message);
      setStartupPhase("error");
    }
  }, []);

  const testOllamaConnection = useCallback(async (address: string) => {
    setIsTestingOllama(true);
    try {
      await llmService.testOllamaConnection(address);
      setOllamaConnectionState("ok");
    } catch {
      setOllamaConnectionState("fail");
    } finally {
      setIsTestingOllama(false);
    }
  }, []);

  const refreshOllamaModels = useCallback(async (address: string, preferredModel?: string) => {
    setIsRefreshingModels(true);
    try {
      const models = await llmService.listOllamaModels(address);
      setOllamaModels(models);
      setOllamaConnectionState("ok");

      if (models.length === 0) return;

      const candidate = preferredModel ?? models[0];
      const nextModel = models.includes(candidate) ? candidate : models[0];
      setSettings((current) =>
        current.ollamaModel === nextModel ? current : { ...current, ollamaModel: nextModel }
      );
      await settingsService.save("ollamaModel", nextModel);
    } catch {
      setOllamaConnectionState("fail");
      setOllamaModels([]);
    } finally {
      setIsRefreshingModels(false);
    }
  }, [setSettings]);

  const refreshLocalEmbeddingStatus = useCallback(async () => {
    try {
      const status = await llmService.getLocalEmbeddingStatus();
      setLocalEmbeddingStatus(status);
    } catch {
      // Ignore transient status polling failures
    }
  }, []);

  const prepareLocalEmbeddingModel = useCallback(async (model: string) => {
    setIsPreparingLocalEmbeddingModel(true);
    try {
      const status = await llmService.prepareLocalEmbeddingModel(model);
      setLocalEmbeddingStatus(status);

      const ready =
        status.state === "ready" &&
        (status.active_model ?? "").toLowerCase() === model.trim().toLowerCase();

      if (ready) {
        setSettings((current) => ({
          ...current,
          localEmbeddingModel: model,
          embeddingInitialized: true,
          embeddingModelLocked: true,
        }));
        setSelectedEmbeddingModel(model);
        await settingsService.save("localEmbeddingModel", model);
        setStartupErrorMessage("");
        setStartupPhase("ready");
      } else {
        throw new Error(status.message || `Failed to prepare embedding model '${model}'.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLocalEmbeddingStatus({
        state: "error",
        active_model: model,
        cache_dir: "",
        message,
      });
    } finally {
      setIsPreparingLocalEmbeddingModel(false);
    }
  }, [setSettings]);

  const listLocalEmbeddingModels = useCallback(async () => {
    try {
      const models = await llmService.listLocalEmbeddingModels();
      if (models.length > 0) {
        setLocalEmbeddingModels(models);
      }
    } catch {
      setLocalEmbeddingModels(LOCAL_EMBEDDING_MODELS as unknown as string[]);
    }
  }, []);

  const updateSetting = useCallback(async <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
    await settingsService.save(key as string, typeof value === "boolean" ? String(value) : String(value));
  }, [setSettings]);

  return {
    settings,
    setSettings,
    isLoaded,
    startupPhase,
    startupErrorMessage,
    ollamaConnectionState,
    isTestingOllama,
    ollamaModels,
    isRefreshingModels,
    localEmbeddingModels,
    localEmbeddingStatus,
    isPreparingLocalEmbeddingModel,
    selectedEmbeddingModel,
    setSelectedEmbeddingModel,
    testOllamaConnection,
    refreshOllamaModels,
    refreshLocalEmbeddingStatus,
    prepareLocalEmbeddingModel,
    listLocalEmbeddingModels,
    updateSetting,
    loadSettings,
    prepareEmbeddingOnStartup,
  };
}