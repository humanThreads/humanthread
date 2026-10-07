import { describe, expect, it } from "vitest";

import { mergeCommandSearchPaths, readLoginShellPath } from "./core";

describe("Desktop command search path", () => {
  it("merges inherited and login-shell paths without duplicates", () => {
    expect(mergeCommandSearchPaths(
      "/usr/bin:/bin:/opt/homebrew/bin",
      "/opt/homebrew/bin:/Users/test/.nvm/versions/node/v24.13.1/bin:/usr/bin",
    )).toBe(
      "/usr/bin:/bin:/opt/homebrew/bin:/Users/test/.nvm/versions/node/v24.13.1/bin",
    );
  });

  it("can read the user's login shell PATH when the GUI has a limited PATH", () => {
    const result = readLoginShellPath({
      SHELL: "/bin/sh",
      PATH: "/usr/bin:/bin",
    });

    expect(result).toContain("/usr/bin");
    expect(result).toContain("/bin");
  });
});
