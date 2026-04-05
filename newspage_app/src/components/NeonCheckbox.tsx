import type React from "react";

interface NeonCheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  isDarkMode: boolean;
  size?: "sm" | "md";
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}

export function NeonCheckbox({
  checked,
  onChange,
  isDarkMode,
  size = "md",
  disabled = false,
  className = "",
  ariaLabel,
}: NeonCheckboxProps): React.JSX.Element {
  const sizeClass = size === "sm" ? "h-4 w-4 rounded" : "h-5 w-5 rounded-md";
  const glyphClass = size === "sm" ? "text-[9px]" : "text-[11px]";

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-disabled={disabled}
      onClick={() => { if (!disabled) onChange(!checked); }}
      className={`group inline-flex items-center justify-center border transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 ${sizeClass} ${
        checked
          ? isDarkMode
            ? "border-cyan-500 bg-cyan-600/12 text-cyan-300 shadow-[0_0_8px_rgba(8,145,178,0.3)] focus-visible:ring-cyan-500"
            : "border-emerald-600 bg-emerald-600/10 text-emerald-800 shadow-[0_0_7px_rgba(5,150,105,0.26)] focus-visible:ring-emerald-500"
          : isDarkMode
            ? "border-zinc-600 bg-zinc-900 text-zinc-600 focus-visible:ring-zinc-500 hover:scale-[1.04] hover:shadow-[0_0_7px_rgba(82,82,91,0.28)]"
            : "border-zinc-300 bg-zinc-100 text-zinc-400 focus-visible:ring-zinc-400 hover:scale-[1.04] hover:shadow-[0_0_7px_rgba(113,113,122,0.22)]"
      } ${disabled ? "opacity-60" : ""} cursor-pointer ${className}`}
    >
      <span className={`${glyphClass} font-black leading-none transition-transform duration-200 ${checked ? "scale-100" : "scale-75 opacity-0"}`}>
        ✓
      </span>
    </button>
  );
}