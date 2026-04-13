import { useTranslation } from "react-i18next";
import { usePanelTransition } from "../hooks/usePanelTransition";

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
  const { t } = useTranslation();
  const { isMounted, isClosing } = usePanelTransition(showCalendar, 170);

  if (!isMounted) {
    return null;
  }

  return (
    <div className={`${isClosing ? "popup-overlay-out" : "popup-overlay"} fixed inset-0 z-50 flex items-center justify-center p-4`}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div
        className={`${isClosing ? "popup-panel-out" : "popup-panel"} relative w-full max-w-sm rounded-3xl border p-8 shadow-2xl ${
          isDarkMode ? "border-zinc-800 bg-zinc-900" : "border-zinc-200 bg-zinc-150"
        }`}
      >
        <h3 className="mb-6 text-sm font-black uppercase tracking-widest opacity-60">{t("calendar.jumpToDate")}</h3>
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
          type="button"
          onClick={onClose}
          className={`mt-6 w-full rounded-lg border px-4 py-2 text-xs font-bold uppercase tracking-widest transition-colors ${
            isDarkMode
              ? "border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
              : "border-zinc-300 bg-zinc-200 text-zinc-700 hover:bg-zinc-300"
          }`}
        >
          {t("common.confirm")}
        </button>
      </div>
    </div>
  );
}
