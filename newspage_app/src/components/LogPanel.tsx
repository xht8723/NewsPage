import React, { useEffect, useMemo, useRef } from "react";
import { X } from "lucide-react";
import type { ProcessLogEntry } from "../types/news";

interface LogPanelProps {
  isDarkMode: boolean;
  logs: ProcessLogEntry[];
  isOpen: boolean;
  onClear: () => void;
  onClose: () => void;
}

const categoryColorMap: Record<string, string> = {
  DB: "text-sky-400",
  Scrape: "text-violet-400",
  Extract: "text-amber-400",
  Enrichment: "text-emerald-400",
  System: "text-cyan-400",
};

function formatTimestamp(raw: string): string {
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return raw;
  }

  return parsed.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function LogPanel({ isDarkMode, logs, isOpen, onClear, onClose }: LogPanelProps): React.JSX.Element | null {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen || !containerRef.current) {
      return;
    }
    containerRef.current.scrollTop = containerRef.current.scrollHeight;
  }, [isOpen, logs]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const onEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("keydown", onEsc);
    };
  }, [isOpen, onClose]);

  const latestCount = useMemo(() => logs.length, [logs.length]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 p-4" onClick={onClose}>
      <div
        className={`flex h-[80vh] w-full max-w-5xl flex-col rounded-2xl border shadow-2xl ${
          isDarkMode ? "border-zinc-700 bg-zinc-900 text-zinc-100" : "border-zinc-300 bg-zinc-100 text-zinc-900"
        }`}
        onClick={(event) => event.stopPropagation()}
      >
        <header
          className={`flex items-center justify-between border-b px-4 py-3 ${
            isDarkMode ? "border-zinc-800" : "border-zinc-200"
          }`}
        >
          <div>
            <h3 className={`text-sm font-black ${isDarkMode ? "text-zinc-100" : "text-zinc-900"}`}>Process Details</h3>
            <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">{latestCount} entries</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClear}
              className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-widest transition-colors ${
                isDarkMode
                  ? "border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                  : "border-zinc-300 text-zinc-700 hover:bg-zinc-200"
              }`}
            >
              Clear
            </button>
            <button
              type="button"
              onClick={onClose}
              className={`rounded-full border p-1.5 transition-colors ${
                isDarkMode ? "border-zinc-700 hover:bg-zinc-800" : "border-zinc-300 hover:bg-zinc-200"
              }`}
              aria-label="Close process details"
            >
              <X size={14} />
            </button>
          </div>
        </header>

        <div ref={containerRef} className="news-scroll min-h-0 flex-1 space-y-2 overflow-y-auto p-3 font-mono text-xs leading-5">
          {logs.length === 0 ? (
            <p className="text-zinc-500">No logs yet.</p>
          ) : (
            logs.map((entry, idx) => {
              const categoryClass = categoryColorMap[entry.category] ?? (isDarkMode ? "text-zinc-300" : "text-zinc-700");
              return (
                <div
                  key={`${entry.timestamp_utc}-${idx}`}
                  className={`rounded-lg border px-3 py-2 ${
                    isDarkMode ? "border-zinc-800 bg-zinc-950/60" : "border-zinc-200 bg-white"
                  }`}
                >
                  <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider">
                    <span className="text-zinc-500">{formatTimestamp(entry.timestamp_utc)}</span>
                    <span className={categoryClass}>{entry.category}</span>
                    <span className={entry.level === "ERROR" ? "text-red-400" : entry.level === "WARN" ? "text-amber-400" : isDarkMode ? "text-zinc-400" : "text-zinc-600"}>
                      {entry.level}
                    </span>
                  </div>
                  <p className={`mt-1 ${isDarkMode ? "text-zinc-200" : "text-zinc-700"}`}>{entry.message}</p>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
