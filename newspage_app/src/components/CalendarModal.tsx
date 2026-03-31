import type React from "react";

interface CalendarModalProps {
  showCalendar: boolean;
  isDarkMode: boolean;
  selectedDate: string;
  onSelectDate: (date: string) => void;
  onClose: () => void;
}

export function CalendarModal({
  showCalendar,
  isDarkMode,
  selectedDate,
  onSelectDate,
  onClose,
}: CalendarModalProps): React.JSX.Element | null {
  if (!showCalendar) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div
        className={`relative w-full max-w-sm rounded-3xl border p-8 shadow-2xl ${
          isDarkMode ? "border-zinc-800 bg-zinc-900" : "border-zinc-200 bg-zinc-150"
        }`}
      >
        <h3 className="mb-6 text-sm font-black uppercase tracking-widest opacity-60">Jump to Date</h3>
        <input
          type="date"
          value={selectedDate}
          onChange={(e) => {
            onSelectDate(e.target.value);
            onClose();
          }}
          className={`w-full rounded-xl border p-4 text-sm font-bold outline-none transition-all focus:ring-2 focus:ring-zinc-500 ${
            isDarkMode ? "border-zinc-700 bg-zinc-800 text-white" : "border-zinc-200 bg-zinc-150 text-black"
          }`}
        />
        <button
          onClick={onClose}
          className={`mt-6 w-full rounded-xl py-4 text-xs font-black uppercase tracking-widest transition-all ${
            isDarkMode ? "bg-zinc-200 text-zinc-900 hover:bg-white" : "bg-zinc-800 text-white hover:bg-zinc-900"
          }`}
        >
          Confirm
        </button>
      </div>
    </div>
  );
}
