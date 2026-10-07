import { describe, expect, it, vi } from "vitest";

import { loadProjectConstraints } from "./project-constraints";

function createConstraintFiles(files: Record<string, string>) {
  const readFile = vi.fn(async (input: { relativePath: string }) => files[input.relativePath] ?? null);
  const resolveNativePath = vi.fn(async (workspaceRoot: string, requestedPath: string) => ({
    workspaceRealpath: workspaceRoot,
    targetRealpath: requestedPath,
    contained: requestedPath === workspaceRoot || requestedPath.startsWith(`${workspaceRoot}/`),
  }));
  return { readFile, resolveNativePath };
}

describe("loadProjectConstraints", () => {
  it("loads root, declared, and nearest hierarchical constraints for a target", async () => {
    const files = createConstraintFiles({
      "humanthread.yaml": [
        "schemaVersion: 1",
        "constraints:",
        "  sources:",
        "    - CONTRIBUTING.md",
        "  hierarchical:",
        "    enabled: true",
        "    filename: AGENTS.md",
        "  checks:",
        "    - corepack pnpm test",
      ].join("\n"),
      "AGENTS.md": "root rules",
      "CONTRIBUTING.md": "contribution rules",
      "packages/web/AGENTS.md": "web rules",
      "packages/api/AGENTS.md": "api rules",
    });

    const bundle = await loadProjectConstraints({
      workspaceRoot: "/repo",
      targetPaths: ["packages/web/src/page.tsx"],
    }, files);

    expect(bundle.sources.map(({ relativePath }) => relativePath)).toEqual([
      "AGENTS.md",
      "CONTRIBUTING.md",
      "packages/web/AGENTS.md",
    ]);
    expect(bundle.sources.map(({ content }) => content)).toEqual([
      "root rules",
      "contribution rules",
      "web rules",
    ]);
    expect(bundle.checks).toEqual([{ name: "check-1", command: "corepack pnpm test" }]);
    expect(bundle.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("does not load hierarchical rules from an unrelated package", async () => {
    const files = createConstraintFiles({
      "humanthread.yaml": [
        "schemaVersion: 1",
        "constraints:",
        "  sources: []",
        "  hierarchical:",
        "    enabled: true",
        "    filename: AGENTS.md",
        "  checks: []",
      ].join("\n"),
      "AGENTS.md": "root rules",
      "packages/web/AGENTS.md": "web rules",
      "packages/api/AGENTS.md": "api rules",
    });

    const bundle = await loadProjectConstraints({
      workspaceRoot: "/repo",
      targetPaths: ["packages/api/src/index.ts"],
    }, files);

    expect(bundle.sources.map(({ relativePath }) => relativePath)).toEqual([
      "AGENTS.md",
      "packages/api/AGENTS.md",
    ]);
  });

  it("rejects a declared path outside the Workspace", async () => {
    const files = createConstraintFiles({
      "humanthread.yaml": [
        "schemaVersion: 1",
        "constraints:",
        "  sources:",
        "    - ../secrets.md",
      ].join("\n"),
    });

    await expect(loadProjectConstraints({
      workspaceRoot: "/repo",
      targetPaths: ["packages/web/src/page.tsx"],
    }, files)).rejects.toMatchObject({ code: "workspace_scope_denied" });
  });

  it("rejects a constraint bundle that exceeds the local byte limit", async () => {
    const files = createConstraintFiles({
      "humanthread.yaml": [
        "schemaVersion: 1",
        "constraints:",
        "  sources:",
        "    - CONTRIBUTING.md",
      ].join("\n"),
      "CONTRIBUTING.md": "x".repeat(100_000),
    });

    await expect(loadProjectConstraints({
      workspaceRoot: "/repo",
      targetPaths: ["."],
    }, files)).rejects.toMatchObject({ code: "constraint_bundle_too_large" });
  });
});
