import { LayoutGrid, LayoutList, Rows3 } from "lucide-react";
import type React from "react";
import { memo } from "react";
import type { LayoutMode } from "../constants/article";

interface LayoutSwitcherProps {
  show: boolean;
  isDarkMode: boolean;
  layout: LayoutMode;
  onSetLayout: (mode: LayoutMode) => void;
}

function LayoutSwitcherComponent({ show, isDarkMode, layout, onSetLayout }: LayoutSwitcherProps): React.JSX.Element {
  return (
    <div
      className={`fixed bottom-8 left-1/2 z-30 -translate-x-1/2 transition-all duration-200 md:left-[calc(50%+128px)] ${
        show ? "opacity-100" : "pointer-events-none translate-y-3 opacity-0"
      }`}
    >
      <div
        className={`flex items-center gap-1 rounded-full border p-1 shadow-xl backdrop-blur-lg ${
          isDarkMode ? "border-zinc-700 bg-zinc-900/80 text-zinc-400" : "border-zinc-300 bg-zinc-150/90 text-zinc-600"
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
        <button
          onClick={() => onSetLayout("compact_list")}
          className={`rounded-full p-2.5 transition-all ${
            layout === "compact_list"
              ? isDarkMode
                ? "bg-zinc-100 text-black shadow-md"
                : "bg-zinc-800 text-white shadow-md"
              : "hover:bg-zinc-500/10"
          }`}
        >
          <Rows3 size={16} />
        </button>
      </div>
    </div>
  );
}

export const LayoutSwitcher = memo(LayoutSwitcherComponent);
