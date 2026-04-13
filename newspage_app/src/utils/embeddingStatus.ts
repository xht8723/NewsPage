import type { LocalEmbeddingStatus } from "../types/article";
import i18n from "../i18n";

export function getEmbeddingStatusMessage(status: LocalEmbeddingStatus | null): string {
  if (!status) {
    return i18n.t("settings.modelNotConfigured");
  }
  const model = status.active_model ?? "";
  switch (status.state) {
    case "ready":
      return i18n.t("settings.modelReady", { model });
    case "downloading":
      return i18n.t("settings.modelDownloading", { model });
    case "loading":
      return i18n.t("settings.modelLoading", { model });
    default:
      return status.message;
  }
}