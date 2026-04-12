import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

interface CustomSelectOption {
  value: string;
  label: string;
}

interface CustomSelectProps {
  options: CustomSelectOption[];
  value: string;
  onChange: (value: string) => void;
  isDarkMode: boolean;
  className?: string;
}

export function CustomSelect({
  options,
  value,
  onChange,
  isDarkMode,
  className = "",
}: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const idx = options.findIndex((o) => o.value === value);
    if (idx < 0) return;
    const item = listRef.current.children[idx] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [open, options, value]);

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm focus:outline-none ${
          isDarkMode
            ? "border-zinc-700 bg-zinc-800 text-zinc-100"
            : "border-zinc-300 bg-zinc-200 text-zinc-900"
        }`}
      >
        <span>{selected?.label ?? value}</span>
        <ChevronDown
          size={14}
          className={`shrink-0 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <ul
          ref={listRef}
          className={`news-scroll absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border py-1 shadow-lg ${
            isDarkMode
              ? `${"news-scroll-dark"} border-zinc-700 bg-zinc-900`
              : `${"news-scroll-light"} border-zinc-300 bg-zinc-100`
          }`}
        >
          {options.map((opt) => (
            <li key={opt.value}>
              <button
                type="button"
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`w-full px-3 py-1.5 text-left text-sm transition-colors ${
                  opt.value === value
                    ? isDarkMode
                      ? "bg-zinc-700/60 text-zinc-100"
                      : "bg-zinc-300/60 text-zinc-900"
                    : isDarkMode
                      ? "text-zinc-300 hover:bg-zinc-800"
                      : "text-zinc-700 hover:bg-zinc-200"
                }`}
              >
                {opt.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
