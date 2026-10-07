import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createNodeProjectFilesystem } from "./node-project-filesystem";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "ht-loop-sync-")));
  roots.push(root);
  return { root, fs: createNodeProjectFilesystem(root) };
}

describe("createNodeProjectFilesystem", () => {
  it("atomically replaces only generated projections and a managed CLAUDE block", async () => {
    const { root, fs } = await fixture();
    await writeFile(join(root, "CLAUDE.md"), "# User rules\n\nKeep this text.\n", "utf8");
    const claude = [
      "# User rules",
      "",
      "Keep this text.",
      "<!-- HUMANTHREAD:SKILLS:START -->",
      "Read .agents/skills/ when a stage selects a Skill.",
      "<!-- HUMANTHREAD:SKILLS:END -->",
      "",
    ].join("\n");
    const allowed = [
      ".humanthread/structure/manifest.json",
      ".humanthread/structure/lock.json",
      ".humanthread/CONFIGURATION.md",
      ".humanthread/loops/project--loop_project/loop.yaml",
    ];

    for (const path of allowed) await fs.writeTextAtomic(path, `generated: ${path}\n`);
    await fs.writeTextAtomic("CLAUDE.md", claude);

    await expect(fs.writeTextAtomic(".humanthread/loops/project/subloops/develop/stage.yaml", "replacement\n"))
      .rejects.toMatchObject({ code: "atomic_write_denied" });
    await expect(fs.writeTextAtomic("CLAUDE.md", "# Replaced user rules\n"))
      .rejects.toMatchObject({ code: "atomic_write_denied" });
    expect(await readFile(join(root, "CLAUDE.md"), "utf8")).toBe(claude);
  });

  it("moves only a v1 node directory into its matching transaction backup", async () => {
    const { root, fs } = await fixture();
    const source = ".humanthread/loops/project/nodes/develop";
    const transaction = ".humanthread/runtime/sync/v1-to-v2-project_1";
    const backup = `${transaction}/backup/loops/project/nodes/develop`;
    await mkdir(join(root, source), { recursive: true });
    await writeFile(join(root, source, "node.yaml"), "schemaVersion: 1\n", "utf8");

    await fs.renameExclusive(source, backup);
    expect(await fs.listTree(backup)).toEqual([`${backup}/node.yaml`]);
    await expect(fs.renameExclusive(".humanthread/loops/project/subloops/develop", `${transaction}/backup/invalid`))
      .rejects.toMatchObject({ code: "workspace_scope_denied" });

    await fs.removeTransactionTree(transaction);
    expect(await fs.listTree(transaction)).toEqual([]);
    await expect(fs.removeTransactionTree(".humanthread/runtime/sync"))
      .rejects.toMatchObject({ code: "workspace_scope_denied" });
  });

  it("rejects generated writes through a symlink", async () => {
    const { root, fs } = await fixture();
    await mkdir(join(root, "outside"), { recursive: true });
    await mkdir(join(root, ".humanthread"), { recursive: true });
    await symlink(join(root, "outside"), join(root, ".humanthread", "structure"));

    await expect(fs.writeTextAtomic(".humanthread/structure/manifest.json", "{}\n"))
      .rejects.toMatchObject({ code: "workspace_scope_denied" });
  });
});
