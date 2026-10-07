import { describe, expect, it } from "vitest";

import { assertReleaseSource } from "./release-source.mjs";

function gitFixture(input: Record<string, string> = {}) {
  const values = new Map(Object.entries({
    "branch --show-current": "main",
    "rev-parse --path-format=absolute --git-dir": "/repo/.git",
    "rev-parse --path-format=absolute --git-common-dir": "/repo/.git",
    "status --porcelain=v1 --untracked-files=all": "",
    "rev-parse --verify HEAD": "a".repeat(40),
    "rev-parse --verify origin/main": "a".repeat(40),
    ...input,
  }));
  return (args: string[]) => values.get(args.join(" ")) ?? "";
}

describe("assertReleaseSource", () => {
  it("accepts synchronized clean main", () => {
    expect(() => assertReleaseSource({ execGit: gitFixture() })).not.toThrow();
  });
  it.each([
    ["branch --show-current", "feature/worker", "from main"],
    ["rev-parse --path-format=absolute --git-dir", "/repo/.git/worktrees/task", "primary main checkout"],
    ["status --porcelain=v1 --untracked-files=all", " M app.ts", "clean main worktree"],
    ["rev-parse --verify origin/main", "b".repeat(40), "HEAD to match origin/main"],
  ])("rejects invalid source", (key, value, message) => {
    expect(() => assertReleaseSource({ execGit: gitFixture({ [key]: value }) })).toThrow(message);
  });
});
