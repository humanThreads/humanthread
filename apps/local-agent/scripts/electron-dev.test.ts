import { describe, expect, it } from "vitest";

import { DEFAULT_ELECTRON_DEV_PORT, buildElectronDevPlan } from "./electron-dev";

describe("electron dev", () => {
  it("starts Vite on the selected port and points Electron at it", () => {
    const plan = buildElectronDevPlan(DEFAULT_ELECTRON_DEV_PORT);

    expect(plan.port).toBe(1420);
    expect(plan.url).toBe("http://127.0.0.1:1420");
    expect(plan.viteArgs).toEqual(["exec", "vite", "--port", "1420", "--strictPort"]);
    expect(plan.electronEnvironment.HUMANTHREAD_DEV_SERVER_URL).toBe(
      "http://127.0.0.1:1420",
    );
  });
});
