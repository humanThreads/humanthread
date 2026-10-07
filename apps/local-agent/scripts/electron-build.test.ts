import { describe, expect, it } from "vitest";

import {
  buildElectronBuilderInvocation,
  parseElectronBuildArgs,
} from "./electron-build";

describe("electron build", () => {
  it("forwards CLI options to electron-builder without a Tauri preset", () => {
    expect(parseElectronBuildArgs(["--", "--mac", "zip"])).toEqual(["--mac", "zip"]);
    expect(buildElectronBuilderInvocation([])).toEqual({
      command: "pnpm",
      args: ["exec", "electron-builder"],
    });
    expect(buildElectronBuilderInvocation(["--", "--win", "msi"])).toEqual({
      command: "pnpm",
      args: ["exec", "electron-builder", "--win", "msi"],
    });
  });
});
