import { QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { createDesktopQueryClient } from "../lib/query-client";
import type { Appearance } from "../theme/appearance";
import { ThemeProvider } from "../theme/theme-provider";

export function AppProviders(props: {
  children: ReactNode;
  initialAppearance?: Appearance;
  onAppearanceChange?: (appearance: Appearance) => void;
}) {
  const [queryClient] = useState(createDesktopQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        {...(props.initialAppearance ? { initialAppearance: props.initialAppearance } : {})}
        {...(props.onAppearanceChange ? { onAppearanceChange: props.onAppearanceChange } : {})}
      >
        {props.children}
      </ThemeProvider>
    </QueryClientProvider>
  );
}
