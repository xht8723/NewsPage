import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, ThumbsUp, ThumbsDown } from "lucide-react";
import type React from "react";
import type { CardContextMenuState } from "../types/article";
import { useClampedMenuPosition } from "../hooks/useClampedMenuPosition";

interface CardContextMenuProps {
  contextMenu: CardContextMenuState;
  isDarkMode: boolean;
  isClosing?: boolean;
  reprocessingArticleId: string | null;
  isSourceBlacklisted: boolean;
  sortMode: string;
  llmAvailable: boolean;
  onClose: () => void;
  onReprocess: (articleId: string) => void;
  onHideSource: (sourceName: string) => void;
  onVote: (articleId: string, direction: 1 | -1) => void;
}

export function CardContextMenu({
  contextMenu,
  isDarkMode,
  isClosing = false,
  reprocessingArticleId,
  isSourceBlacklisted,
  sortMode,
  llmAvailable,
  onClose,
  onReprocess,
  onHideSource,
  onVote,
}: CardContextMenuProps): React.JSX.Element {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  useClampedMenuPosition(menuRef, contextMenu.x, contextMenu.y);
  const isCurrentCardReprocessing = reprocessingArticleId === contextMenu.article.id;
  const article = contextMenu.article;

  return (
    <div className={`${isClosing ? "popup-overlay-out" : "popup-overlay"} fixed inset-0 z-40`} onClick={onClose}>
      <div
        ref={menuRef}
        className={`${isClosing ? "popup-panel-pop-out" : "popup-panel-pop"} absolute min-w-[220px] rounded-xl border p-2 shadow-2xl ${
          isDarkMode ? "border-zinc-700 bg-zinc-900 text-zinc-200" : "border-zinc-300 bg-zinc-150 text-zinc-900"
        }`}
        style={{ left: contextMenu.x, top: contextMenu.y }}
        onClick={(event) => event.stopPropagation()}
      >
        {sortMode === "score" && (
          <>
            <button
              type="button"
              onClick={() => { onVote(article.id, 1); onClose(); }}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-bold transition-colors ${
                isDarkMode ? "hover:bg-zinc-800" : "hover:bg-zinc-200"
              }`}
            >
              <span>{article.vote === 1 ? t("article.votedLike") : t("article.likeTopic")}</span>
              <ThumbsUp size={14} />
            </button>
            <button
              type="button"
              onClick={() => { onVote(article.id, -1); onClose(); }}
              className={`mt-1 flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-bold transition-colors ${
                isDarkMode ? "hover:bg-zinc-800" : "hover:bg-zinc-200"
              }`}
            >
              <span>{article.vote === -1 ? t("article.votedDislike") : t("article.dislikeTopic")}</span>
              <ThumbsDown size={14} />
            </button>
            <div className={`my-1.5 border-t ${isDarkMode ? "border-zinc-700" : "border-zinc-200"}`} />
          </>
        )}
        <button
          type="button"
          disabled={isCurrentCardReprocessing || !llmAvailable}
          onClick={() => onReprocess(contextMenu.article.id)}
          className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-bold transition-colors ${
            isDarkMode ? "hover:bg-zinc-800" : "hover:bg-zinc-200"
          } disabled:cursor-not-allowed disabled:opacity-50`}
        >
          <span>{isCurrentCardReprocessing ? t("article.reprocessing") : t("article.reprocess")}</span>
          <ChevronRight size={14} />
        </button>
        <button
          type="button"
          disabled={isSourceBlacklisted}
          onClick={() => onHideSource(contextMenu.article.sourceName)}
          className={`mt-1 flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-bold transition-colors ${
            isDarkMode ? "hover:bg-zinc-800" : "hover:bg-zinc-200"
          } disabled:cursor-not-allowed disabled:opacity-50`}
        >
          <span>
            {isSourceBlacklisted
              ? t("article.sourceAlreadyHidden", { source: contextMenu.article.sourceName })
              : t("article.hideSource", { source: contextMenu.article.sourceName })}
          </span>
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}
