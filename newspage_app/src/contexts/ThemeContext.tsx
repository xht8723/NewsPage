import React, { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";

interface ThemeContextValue {
  isDarkMode: boolean;
  toggleDarkMode: () => void;
  setDarkMode: (isDark: boolean) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

interface ThemeProviderProps {
  children: ReactNode;
  initialDarkMode?: boolean;
}

export function ThemeProvider({ children, initialDarkMode = true }: ThemeProviderProps): React.JSX.Element {
  const [isDarkMode, setIsDarkMode] = useState(initialDarkMode);

  useEffect(() => {
    const html = document.documentElement;
    if (isDarkMode) {
      html.classList.add("dark");
    } else {
      html.classList.remove("dark");
    }
  }, [isDarkMode]);

  const toggleDarkMode = useCallback(() => {
    setIsDarkMode((prev) => !prev);
  }, []);

  const setDarkMode = useCallback((isDark: boolean) => {
    setIsDarkMode(isDark);
  }, []);

  return (
    <ThemeContext.Provider value={{ isDarkMode, toggleDarkMode, setDarkMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}