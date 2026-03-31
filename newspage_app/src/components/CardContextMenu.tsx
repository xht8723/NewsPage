import { ChevronRight } from "lucide-react";
import type React from "react";
import type { CardContextMenuState } from "../types/news";

interface CardContextMenuProps {
  contextMenu: CardContextMenuState;
  isDarkMode: boolean;
  reprocessingArticleId: string | null;
  onClose: () => void;
  onReprocess: (articleId: string) => void;
}

export function CardContextMenu({
  contextMenu,
  isDarkMode,
  reprocessingArticleId,
  onClose,
  onReprocess,
}: CardContextMenuProps): React.JSX.Element {
  const isCurrentCardReprocessing = reprocessingArticleId === contextMenu.article.id;

  return (
    <div className="fixed inset-0 z-40" onClick={onClose}>
      <div
        className={`absolute min-w-[220px] rounded-xl border p-2 shadow-2xl ${
          isDarkMode ? "border-zinc-700 bg-zinc-900 text-zinc-200" : "border-zinc-300 bg-zinc-150 text-zinc-900"
        }`}
        style={{ left: contextMenu.x, top: contextMenu.y }}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          disabled={isCurrentCardReprocessing}
          onClick={() => onReprocess(contextMenu.article.id)}
          className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-bold transition-colors ${
            isDarkMode ? "hover:bg-zinc-800" : "hover:bg-zinc-200"
          } disabled:cursor-not-allowed disabled:opacity-50`}
        >
          <span>{isCurrentCardReprocessing ? "Re-processing..." : "Re-process this card"}</span>
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}
