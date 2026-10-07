import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

const root = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("Usage: node scripts/fix-node-esm-specifiers.mjs <dist-directory>");

async function listJavaScriptFiles(directory) {
  const entries = await readdir(directory);
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry);
    const metadata = await stat(path);
    if (metadata.isDirectory()) files.push(...await listJavaScriptFiles(path));
    else if (path.endsWith(".js")) files.push(path);
  }
  return files;
}

function withJavaScriptExtension(specifier) {
  if (!specifier.startsWith(".") || extname(specifier)) return specifier;
  return `${specifier}.js`;
}

for (const file of await listJavaScriptFiles(root)) {
  const source = await readFile(file, "utf8");
  const updated = source
    .replace(
      /((?:from\s+|import\s*)["'])(\.{1,2}\/[^"']+)(["'])/gu,
      (_match, prefix, specifier, suffix) => `${prefix}${withJavaScriptExtension(specifier)}${suffix}`,
    )
    .replace(
      /((?:import\s*\(\s*)["'])(\.{1,2}\/[^"']+)(["']\s*\))/gu,
      (_match, prefix, specifier, suffix) => `${prefix}${withJavaScriptExtension(specifier)}${suffix}`,
    );
  if (updated !== source) await writeFile(file, updated, "utf8");
}
