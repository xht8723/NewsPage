interface ConfigPopupDialogProps {
  isDarkMode: boolean;
  isClosing: boolean;
  message: string;
  onDismiss: () => void;
}

export function ConfigPopupDialog({
  isDarkMode,
  isClosing,
  message,
  onDismiss,
}: ConfigPopupDialogProps) {
  return (
    <div
      className={`${isClosing ? "popup-overlay-out" : "popup-overlay"} fixed inset-0 z-[130] flex items-center justify-center bg-black/60 p-4`}
      onClick={onDismiss}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`${isClosing ? "popup-panel-out" : "popup-panel"} w-full max-w-sm rounded-2xl border p-6 shadow-2xl ${
          isDarkMode ? "border-zinc-700 bg-zinc-900 text-zinc-100" : "border-zinc-300 bg-zinc-150 text-zinc-900"
        }`}
      >
        <p className={`mb-1 text-[10px] font-bold uppercase tracking-widest ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>
          Setup required
        </p>
        <p className={`mb-5 text-sm leading-relaxed ${isDarkMode ? "text-zinc-300" : "text-zinc-700"}`}>
          {message}
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onDismiss}
            className={`rounded-lg border px-4 py-2 text-xs font-bold uppercase tracking-widest transition-colors ${
              isDarkMode
                ? "border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                : "border-zinc-300 bg-zinc-200 text-zinc-700 hover:bg-zinc-300"
            }`}
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
