import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(new URL("./fix-node-esm-specifiers.mjs", import.meta.url));

test("adds .js extensions to static and dynamic relative imports", async () => {
  const directory = await mkdtemp(join(tmpdir(), "humanthread-esm-specifiers-"));
  try {
    const file = join(directory, "sample.js");
    await writeFile(file, [
      'import { value } from "./static";',
      'import "./side-effect";',
      'export * from "../exported";',
      'const dynamic = await import("./dynamic");',
      "",
    ].join("\n"));

    await execFileAsync(process.execPath, [scriptPath, directory]);

    await expectSource(file, [
      'import { value } from "./static.js";',
      'import "./side-effect.js";',
      'export * from "../exported.js";',
      'const dynamic = await import("./dynamic.js");',
      "",
    ].join("\n"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

async function expectSource(file, expected) {
  assert.equal(await readFile(file, "utf8"), expected);
}
