import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");

function ignored(path: string): boolean {
  try {
    execFileSync("git", ["check-ignore", "-q", path], { cwd: root });
    return true;
  } catch {
    return false;
  }
}

describe("repository local Loop layout", () => {
  it("tracks structure and rules while ignoring runtime state", () => {
    expect(ignored(".humanthread/structure/manifest.json")).toBe(false);
    expect(ignored(".humanthread/loops/example/subloops/develop/stage.yaml")).toBe(false);
    expect(ignored(".agents/skills/example/SKILL.md")).toBe(false);
    expect(ignored(".humanthread/runtime/outbox.jsonl")).toBe(true);
    expect(ignored(".humanthread/results/output.json")).toBe(true);
    expect(ignored(".humanthread/worktrees/task")).toBe(true);
  });
});
