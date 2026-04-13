import { useTranslation } from "react-i18next";
import { Settings, X } from "lucide-react";
import type React from "react";
import { usePanelTransition } from "../hooks/usePanelTransition";

interface OnboardingGuideProps {
  show: boolean;
  isDarkMode: boolean;
  onDismiss: () => void;
  onGoToSettings: () => void;
}

export function OnboardingGuide({
  show,
  isDarkMode,
  onDismiss,
  onGoToSettings,
}: OnboardingGuideProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const { isMounted, isClosing } = usePanelTransition(show, 170);

  if (!isMounted) {
    return null;
  }

  return (
    <div
      className={`${isClosing ? "popup-overlay-out" : "popup-overlay"} fixed inset-0 z-[140] flex items-center justify-center p-4`}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onDismiss} />
      <div
        className={`${isClosing ? "popup-panel-out" : "popup-panel"} onboarding-panel-glow relative w-full max-w-lg overflow-hidden rounded-3xl border shadow-2xl ${
          isDarkMode
            ? "border-zinc-700 bg-zinc-900 text-zinc-300"
            : "border-zinc-300 bg-white text-zinc-800"
        }`}
      >
        {/* Header */}
        <div
          className={`flex items-center justify-between border-b px-6 py-5 ${
            isDarkMode ? "border-zinc-800 bg-zinc-950/60" : "border-zinc-200 bg-zinc-50"
          }`}
        >
          <div className="flex items-center gap-3">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-xl ${
                isDarkMode ? "bg-zinc-800" : "bg-zinc-100"
              }`}
            >
              <img src="/icon.png" alt="NewsPage" className="h-5 w-5" />
            </div>
            <h3 className="text-sm font-bold uppercase tracking-widest">{t("onboarding.welcome")}</h3>
          </div>
          <button
            onClick={onDismiss}
            className={`rounded-lg p-1 transition-opacity hover:opacity-50`}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-5 px-6 py-6">
          {/* Main explanation */}
          <div className="space-y-3">
            <p className={`text-sm leading-relaxed ${isDarkMode ? "text-zinc-300" : "text-zinc-700"}`}>
              <span dangerouslySetInnerHTML={{ __html: t("onboarding.description") }} />
            </p>
            <div
              className={`rounded-xl border p-4 ${
                isDarkMode ? "border-cyan-900/60 bg-cyan-950/30" : "border-cyan-200 bg-cyan-50"
              }`}
            >
              <p className={`text-xs leading-relaxed ${isDarkMode ? "text-cyan-300" : "text-cyan-700"}`}>
                <span dangerouslySetInnerHTML={{ __html: t("onboarding.explanation") }} />
              </p>
            </div>
          </div>

        </div>

        {/* Footer */}
        <div
          className={`flex items-center justify-between border-t px-6 py-4 ${
            isDarkMode ? "border-zinc-800 bg-zinc-950/40" : "border-zinc-200 bg-zinc-50"
          }`}
        >
          <p className={`text-[11px] ${isDarkMode ? "text-zinc-600" : "text-zinc-400"}`}>
            {t("onboarding.laterHint")} <Settings size={11} className="inline mb-0.5" />
          </p>
          <button
            type="button"
            onClick={onGoToSettings}
            className={`rounded-lg px-3 py-1 text-[11px] font-medium transition-colors ${
              isDarkMode
                ? "bg-cyan-700 text-white hover:bg-cyan-600"
                : "bg-cyan-600 text-white hover:bg-cyan-500"
            }`}
          >
            {t("onboarding.goToSettings")}
          </button>
        </div>
      </div>
    </div>
  );
}
