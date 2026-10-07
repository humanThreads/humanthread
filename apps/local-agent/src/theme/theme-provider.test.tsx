import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppearanceSettings } from "./appearance-settings";
import { ThemeProvider } from "./theme-provider";

describe("desktop appearance", () => {
  afterEach(() => {
    delete document.documentElement.dataset.appearance;
  });

  it("defaults new installations to unified light", () => {
    render(
      <ThemeProvider>
        <AppearanceSettings />
      </ThemeProvider>,
    );

    expect(document.documentElement.dataset.appearance).toBe("light");
    expect(screen.getByRole("radio", { name: "统一浅色" })).toBeChecked();
  });

  it("previews and persists the selected appearance without reloading", async () => {
    const user = userEvent.setup();
    const onAppearanceChange = vi.fn();
    render(
      <ThemeProvider initialAppearance="hybrid" onAppearanceChange={onAppearanceChange}>
        <AppearanceSettings />
      </ThemeProvider>,
    );

    expect(document.documentElement.dataset.appearance).toBe("hybrid");
    await user.click(screen.getByRole("radio", { name: "全局深色" }));

    expect(document.documentElement.dataset.appearance).toBe("dark");
    expect(onAppearanceChange).toHaveBeenLastCalledWith("dark");
    expect(screen.getByRole("radio", { name: "全局深色" })).toBeChecked();
  });
});
