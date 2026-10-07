import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createWorkspaceDirectoryImpl,
  createWorkspaceFileImpl,
  listWorkspaceTreeImpl,
  readWorkspaceFileImpl,
  replaceWorkspaceStructureFileImpl,
  resolveWorkspacePathImpl,
  validateWorkspaceDirectoryImpl,
  writeWorkspaceFileImpl,
} from "./workspace";

let workspaceRoot: string;

beforeEach(() => {
  workspaceRoot = realpathSync(mkdtempSync(join(tmpdir(), "humanthread-ws-")));
});

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true });
});

describe("workspace path confinement", () => {
  it("rejects relative workspace directories", () => {
    expect(() => validateWorkspaceDirectoryImpl("relative/path")).toThrow(
      "Project Workspace path must be absolute",
    );
  });

  it("rejects traversal outside the workspace", () => {
    expect(() => resolveWorkspacePathImpl(workspaceRoot, "/etc/passwd")).toThrow(
      "Resolved path is outside the project Workspace",
    );
  });

  it("rejects missing paths that still contain parent traversal", () => {
    expect(() =>
      resolveWorkspacePathImpl(workspaceRoot, `${workspaceRoot}/missing/../secret`),
    ).toThrow("Parent traversal is forbidden in unresolved Workspace paths");
  });

  it("resolves a missing child path inside the workspace", () => {
    const resolution = resolveWorkspacePathImpl(
      workspaceRoot,
      join(workspaceRoot, "src", "new-file.ts"),
    );
    expect(resolution.contained).toBe(true);
    expect(resolution.targetRealpath).toBe(join(workspaceRoot, "src", "new-file.ts"));
  });
});

describe("workspace file operations", () => {
  it("round-trips atomic writes and bounded reads", () => {
    const target = join(workspaceRoot, "notes", "loop.md");
    const written = writeWorkspaceFileImpl(workspaceRoot, target, "hello");
    expect(written).toBe(target);
    expect(readWorkspaceFileImpl(workspaceRoot, target, 1_024)).toBe("hello");

    const oversized = writeWorkspaceFileImpl(workspaceRoot, target, "x".repeat(2_048));
    expect(oversized).toBe(target);
    expect(() => readWorkspaceFileImpl(workspaceRoot, target, 100)).toThrow(
      "Workspace file exceeds the requested read limit",
    );
  });

  it("creates files exclusively", () => {
    const target = join(workspaceRoot, "once.txt");
    createWorkspaceFileImpl(workspaceRoot, target, "first");
    expect(() => createWorkspaceFileImpl(workspaceRoot, target, "second")).toThrow(
      "Failed to create exclusive Workspace file",
    );
  });

  it("creates directories and reads missing files as null", () => {
    const directory = createWorkspaceDirectoryImpl(workspaceRoot, join(workspaceRoot, "a/b"));
    expect(directory).toBe(join(workspaceRoot, "a/b"));
    expect(readWorkspaceFileImpl(workspaceRoot, join(directory, "missing.txt"), 100)).toBeNull();
  });
});

describe("workspace structure files", () => {
  it("only replaces generated structure projections or the managed CLAUDE.md block", () => {
    expect(() =>
      replaceWorkspaceStructureFileImpl(workspaceRoot, join(workspaceRoot, "src/index.ts"), "nope"),
    ).toThrow("Atomic replacement is limited to HumanThread structure files");

    const structural = replaceWorkspaceStructureFileImpl(
      workspaceRoot,
      join(workspaceRoot, ".humanthread/structure/lock.json"),
      "{}",
    );
    expect(structural).toContain(".humanthread/structure/lock.json");
  });

  it("preserves CLAUDE.md content outside the managed block", () => {
    const target = join(workspaceRoot, "CLAUDE.md");
    writeFileSync(
      target,
      "# Rules\n<!-- HUMANTHREAD:SKILLS:START -->\nold\n<!-- HUMANTHREAD:SKILLS:END -->\n",
      "utf8",
    );
    const next = "# Rules\n<!-- HUMANTHREAD:SKILLS:START -->\nnew\n<!-- HUMANTHREAD:SKILLS:END -->\n";
    expect(replaceWorkspaceStructureFileImpl(workspaceRoot, target, next)).toBe(target);
    expect(readWorkspaceFileImpl(workspaceRoot, target, 1_024)).toBe(next);

    const tampered = "# Changed\n<!-- HUMANTHREAD:SKILLS:START -->\nnew\n<!-- HUMANTHREAD:SKILLS:END -->\n";
    expect(() => replaceWorkspaceStructureFileImpl(workspaceRoot, target, tampered)).toThrow(
      "CLAUDE.md content outside the HumanThread managed block must remain unchanged",
    );
  });
});

describe("workspace tree listing", () => {
  it("lists sorted relative files and rejects symlinks", () => {
    mkdirSync(join(workspaceRoot, "b"), { recursive: true });
    writeFileSync(join(workspaceRoot, "b/z.txt"), "z", "utf8");
    writeFileSync(join(workspaceRoot, "a.txt"), "a", "utf8");
    expect(listWorkspaceTreeImpl(workspaceRoot, workspaceRoot, 100)).toEqual([
      "a.txt",
      "b/z.txt",
    ]);

    symlinkSync(join(workspaceRoot, "a.txt"), join(workspaceRoot, "link.txt"));
    expect(() => listWorkspaceTreeImpl(workspaceRoot, workspaceRoot, 100)).toThrow(
      "Symlinks are forbidden in local Loop configuration",
    );
  });
});
