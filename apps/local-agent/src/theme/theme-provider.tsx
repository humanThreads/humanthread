import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { normalizeAppearance, type Appearance } from "./appearance";

interface ThemeContextValue {
  appearance: Appearance;
  setAppearance: (appearance: Appearance) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider(props: {
  children: ReactNode;
  initialAppearance?: Appearance;
  onAppearanceChange?: (appearance: Appearance) => void;
}) {
  const [appearance, setAppearanceState] = useState<Appearance>(() =>
    normalizeAppearance(props.initialAppearance),
  );

  useEffect(() => {
    document.documentElement.dataset.appearance = appearance;
    document.documentElement.style.colorScheme = appearance === "dark" ? "dark" : "light";
  }, [appearance]);

  const setAppearance = useCallback((nextAppearance: Appearance) => {
    setAppearanceState(nextAppearance);
    props.onAppearanceChange?.(nextAppearance);
  }, [props.onAppearanceChange]);
  const value = useMemo(() => ({ appearance, setAppearance }), [appearance, setAppearance]);

  return <ThemeContext.Provider value={value}>{props.children}</ThemeContext.Provider>;
}

export function useAppearance(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error("useAppearance must be used within ThemeProvider");
  }
  return value;
}
