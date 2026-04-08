import { invoke } from "@tauri-apps/api/core";
import type { LocalEmbeddingStatus } from "../types/news";

export interface TestProviderConnectionRequest {
  provider: string;
  apiKey: string | null;
  endpoint: string | null;
  model: string;
  [key: string]: unknown;
}

export const llmService = {
  testOllamaConnection: (address: string): Promise<boolean> =>
    invoke("test_ollama_connection", { address }),

  listOllamaModels: (address: string): Promise<string[]> =>
    invoke("list_ollama_models", { address }),

  testProviderConnection: (request: TestProviderConnectionRequest): Promise<boolean> =>
    invoke("test_provider_connection", request),

  getLocalEmbeddingStatus: (): Promise<LocalEmbeddingStatus> =>
    invoke("get_local_embedding_status"),

  prepareLocalEmbeddingModel: (model: string): Promise<LocalEmbeddingStatus> =>
    invoke("prepare_local_embedding_model", { model }),

  listLocalEmbeddingModels: (): Promise<string[]> =>
    invoke("list_local_embedding_models"),
};