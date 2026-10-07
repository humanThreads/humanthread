import { describe, expect, it, vi } from "vitest";

import {
  readDesktopQuitState,
  requestDesktopQuit,
  resolveQuitChoices,
} from "./quit-safety";

describe("desktop quit safety", () => {
  it("offers safe choices for a managed command with an external session", () => {
    expect(resolveQuitChoices({ managedRunning: true, externalSession: true })).toEqual([
      "hide_to_tray",
      "keep_session_and_quit",
      "interrupt_and_quit",
      "cancel",
    ]);
  });

  it("offers background continuation before interrupting local TUI/daemon work", () => {
    expect(resolveQuitChoices({ managedRunning: true, externalSession: false })).toEqual([
      "hide_to_tray",
      "interrupt_and_quit",
      "cancel",
    ]);
  });

  it("never offers interruption when no managed command can be interrupted", () => {
    expect(resolveQuitChoices({ managedRunning: false, externalSession: true })).toEqual([
      "keep_session_and_quit",
      "cancel",
    ]);
    expect(resolveQuitChoices({ managedRunning: false, externalSession: false })).toEqual([
      "quit",
      "cancel",
    ]);
    expect(resolveQuitChoices({ managedRunning: true, externalSession: false })[0]).toBe("hide_to_tray");
  });

  it("keeps cancel in the renderer and sends only fixed quit choices natively", async () => {
    const invoke = vi.fn(async () => undefined);

    await expect(requestDesktopQuit("cancel", { invoke })).resolves.toBe("cancelled");
    expect(invoke).not.toHaveBeenCalled();
    await expect(requestDesktopQuit("interrupt_and_quit", { invoke }))
      .resolves.toBe("requested");
    expect(invoke).toHaveBeenCalledWith("quit_desktop", {
      choice: "interrupt_and_quit",
    });
  });

  it("loads a strict native quit state before presenting choices", async () => {
    const invoke = vi.fn(async () => ({
      managedRunning: true,
      externalSession: true,
    }));

    await expect(readDesktopQuitState({ invoke })).resolves.toEqual({
      managedRunning: true,
      externalSession: true,
    });
    expect(invoke).toHaveBeenCalledWith("desktop_quit_state");

    await expect(readDesktopQuitState({
      invoke: async () => ({ managedRunning: "yes", externalSession: false }),
    })).rejects.toThrow("Desktop quit state is invalid");
  });
});
