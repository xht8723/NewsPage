import { CreditCard, LayoutGrid, LayoutList } from "lucide-react";
import type React from "react";
import type { LayoutMode } from "../constants/news";

interface LayoutSwitcherProps {
  show: boolean;
  isDarkMode: boolean;
  layout: LayoutMode;
  onSetLayout: (mode: LayoutMode) => void;
}

export function LayoutSwitcher({ show, isDarkMode, layout, onSetLayout }: LayoutSwitcherProps): React.JSX.Element {
  return (
    <div
      className={`fixed bottom-8 left-1/2 z-30 -translate-x-1/2 transition-all duration-200 md:left-[calc(50%+128px)] ${
        show ? "opacity-100" : "pointer-events-none translate-y-3 opacity-0"
      }`}
    >
      <div
        className={`flex items-center gap-1 rounded-full border p-1 shadow-xl backdrop-blur-lg ${
          isDarkMode ? "border-zinc-700 bg-zinc-900/80 text-zinc-400" : "border-zinc-300 bg-white/80 text-zinc-600"
        }`}
      >
        <button
          onClick={() => onSetLayout("grid")}
          className={`rounded-full p-2.5 transition-all ${
            layout === "grid"
              ? isDarkMode
                ? "bg-zinc-100 text-black shadow-md"
                : "bg-zinc-800 text-white shadow-md"
              : "hover:bg-zinc-500/10"
          }`}
        >
          <LayoutGrid size={16} />
        </button>
        <button
          onClick={() => onSetLayout("card")}
          className={`rounded-full p-2.5 transition-all ${
            layout === "card"
              ? isDarkMode
                ? "bg-zinc-100 text-black shadow-md"
                : "bg-zinc-800 text-white shadow-md"
              : "hover:bg-zinc-500/10"
          }`}
        >
          <CreditCard size={16} />
        </button>
        <button
          onClick={() => onSetLayout("list")}
          className={`rounded-full p-2.5 transition-all ${
            layout === "list"
              ? isDarkMode
                ? "bg-zinc-100 text-black shadow-md"
                : "bg-zinc-800 text-white shadow-md"
              : "hover:bg-zinc-500/10"
          }`}
        >
          <LayoutList size={16} />
        </button>
      </div>
    </div>
  );
}
