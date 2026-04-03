import type React from "react";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import type { UserSettings } from "../types/news";
import { MOCK_RSSHUB_ROUTES, normalizeRssHubInstanceDomain } from "../utils/rssSettings";

interface RssHubSettingsModalProps {
  show: boolean;
  isDarkMode: boolean;
  settings: UserSettings;
  setSettings: Dispatch<SetStateAction<UserSettings>>;
  saveSetting: (key: string, value: string) => void;
  onClose: () => void;
}

export function RssHubSettingsModal({
  show,
  isDarkMode,
  settings,
  setSettings,
  saveSetting,
  onClose,
}: RssHubSettingsModalProps): React.JSX.Element | null {
  const [draftDomain, setDraftDomain] = useState(settings.rssHubInstanceDomain);

  useEffect(() => {
    if (show) {
      setDraftDomain(settings.rssHubInstanceDomain);
    }
  }, [show, settings.rssHubInstanceDomain]);

  if (!show) {
    return null;
  }

  const updateDomain = (nextValue: string) => {
    const normalized = normalizeRssHubInstanceDomain(nextValue);
    setDraftDomain(normalized);
    setSettings((current) => ({ ...current, rssHubInstanceDomain: normalized }));
    saveSetting("rssHubInstanceDomain", normalized);
  };

  const toggleRoute = (routeId: string) => {
    const checked = settings.selectedRssHubRoutes.includes(routeId);
    const nextRoutes = checked
      ? settings.selectedRssHubRoutes.filter((route) => route !== routeId)
      : [...settings.selectedRssHubRoutes, routeId];
    setSettings((current) => ({ ...current, selectedRssHubRoutes: nextRoutes }));
    saveSetting("selectedRssHubRoutes", JSON.stringify(nextRoutes));
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={onClose} />
      <div
        className={`relative w-full max-w-2xl overflow-hidden rounded-3xl border shadow-2xl ${
          isDarkMode ? "border-zinc-800 bg-zinc-900 text-zinc-300" : "border-zinc-200 bg-zinc-150 text-zinc-800"
        }`}
      >
        <div
          className={`flex items-center justify-between border-b p-5 ${
            isDarkMode ? "border-zinc-800 bg-zinc-950/50" : "border-zinc-200 bg-zinc-150"
          }`}
        >
          <div>
            <p className={`text-[10px] font-bold uppercase tracking-widest ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>
              RSSHub Settings
            </p>
            <h3 className="text-sm font-bold">Configure instance and mock routes</h3>
          </div>
          <button type="button" onClick={onClose} className="hover:opacity-60" aria-label="Close RSSHub settings">
            <X size={18} />
          </button>
        </div>

        <div className={`max-h-[calc(100vh-12rem)] space-y-4 overflow-y-auto p-5 news-scroll ${isDarkMode ? "news-scroll-dark" : "news-scroll-light"}`}>
          <div>
            <label className="mb-1.5 block text-xs font-medium opacity-70">Instance domain</label>
            <input
              type="text"
              value={draftDomain}
              placeholder="https://rsshub.app/"
              onChange={(event) => setDraftDomain(event.target.value)}
              onBlur={() => updateDomain(draftDomain)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  updateDomain(draftDomain);
                }
              }}
              className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none ${
                isDarkMode
                  ? "border-zinc-700 bg-zinc-800 text-zinc-100 placeholder-zinc-600"
                  : "border-zinc-300 bg-zinc-200 text-zinc-900 placeholder-zinc-500"
              }`}
            />
          </div>

          <div>
            <p className="mb-2 text-xs font-medium opacity-70">Available RSSHub routes</p>
            <div className={`rounded-xl border ${isDarkMode ? "border-zinc-800 bg-zinc-950/40" : "border-zinc-200 bg-white/70"}`}>
              <div className="divide-y divide-zinc-800/20">
                {MOCK_RSSHUB_ROUTES.map((route) => {
                  const checked = settings.selectedRssHubRoutes.includes(route.id);
                  return (
                    <label key={route.id} className="flex cursor-pointer items-start gap-3 px-4 py-3">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleRoute(route.id)}
                        className={`mt-0.5 h-4 w-4 rounded border transition-colors ${
                          isDarkMode
                            ? "border-zinc-500 bg-zinc-800 accent-cyan-600"
                            : "border-zinc-400 bg-white accent-emerald-500"
                        }`}
                      />
                      <div className="min-w-0">
                        <p className={`text-sm font-medium ${isDarkMode ? "text-zinc-200" : "text-zinc-800"}`}>{route.label}</p>
                        <p className={`text-[11px] ${isDarkMode ? "text-zinc-400" : "text-zinc-500"}`}>{route.description}</p>
                        <p className={`mt-1 break-all text-[10px] ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>{route.id}</p>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}