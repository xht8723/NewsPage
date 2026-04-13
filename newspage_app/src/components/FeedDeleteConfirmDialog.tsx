import { useTranslation } from "react-i18next";
import { NeonCheckbox } from "./NeonCheckbox";
import type { FeedDefinition } from "../types/article";

interface FeedDeleteConfirmDialogProps {
  isDarkMode: boolean;
  isClosing: boolean;
  feed: FeedDefinition;
  dontAskAgain: boolean;
  onSetDontAskAgain: (value: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function FeedDeleteConfirmDialog({
  isDarkMode,
  isClosing,
  feed,
  dontAskAgain,
  onSetDontAskAgain,
  onConfirm,
  onCancel,
}: FeedDeleteConfirmDialogProps) {
  const { t } = useTranslation();
  return (
    <div
      className={`${isClosing ? "popup-overlay-out" : "popup-overlay"} fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4`}
      onClick={onCancel}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className={`${isClosing ? "popup-panel-out" : "popup-panel"} w-full max-w-md rounded-2xl border p-6 shadow-2xl ${
          isDarkMode ? "border-zinc-700 bg-zinc-900 text-zinc-100" : "border-zinc-300 bg-zinc-150 text-zinc-900"
        }`}
      >
        <p className={`mb-1 text-[10px] font-bold uppercase tracking-widest ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>
          {t("feedDelete.confirmDeletion")}
        </p>
        <h4 className="mb-3 text-sm font-bold">{t("feedDelete.deleteFeed", { name: feed.name })}</h4>
        <p className={`mb-4 text-xs leading-relaxed ${isDarkMode ? "text-zinc-300" : "text-zinc-700"}`}>
          {t("feedDelete.warning")}
        </p>

        <label className="mb-5 flex cursor-pointer items-center gap-2">
          <NeonCheckbox
            checked={dontAskAgain}
            onChange={onSetDontAskAgain}
            isDarkMode={isDarkMode}
            ariaLabel="Do not ask again for feed deletion"
          />
          <span className="text-xs">{t("feedDelete.dontShowAgain")}</span>
        </label>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className={`rounded-lg border px-4 py-2 text-xs font-bold uppercase tracking-widest transition-colors ${
              isDarkMode
                ? "border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                : "border-zinc-300 bg-zinc-200 text-zinc-700 hover:bg-zinc-300"
            }`}
          >
{t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-red-600 px-4 py-2 text-xs font-bold uppercase tracking-widest text-white transition-colors hover:bg-red-700"
          >
            {t("feedDelete.deleteFeedBtn")}
          </button>
        </div>
      </div>
    </div>
  );
}
