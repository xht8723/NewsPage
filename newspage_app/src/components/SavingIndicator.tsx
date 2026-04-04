interface SavingIndicatorProps {
  isSaving: boolean;
  isDarkMode: boolean;
}

export function SavingIndicator({ isSaving, isDarkMode }: SavingIndicatorProps): React.JSX.Element | null {
  if (!isSaving) {
    return null;
  }

  return (
    <div
      className={`fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-all ${
        isSaving
          ? isDarkMode
            ? "bg-zinc-800/90 text-zinc-300 opacity-100"
            : "bg-zinc-100/90 text-zinc-700 opacity-100"
          : "opacity-0 pointer-events-none"
      }`}
    >
      <div className="flex items-center gap-1.5">
        <div className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
        <span>Saving...</span>
      </div>
    </div>
  );
}
