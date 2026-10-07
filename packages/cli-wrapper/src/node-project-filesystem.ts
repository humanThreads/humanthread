import { execFile } from "node:child_process";
import { access, lstat, mkdir, open, readdir, readFile, realpath, rename, rm } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

import type { ProjectLoopSyncFilesystem } from "@humanthread/project-loop-sync";

const execFileAsync = promisify(execFile);
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TREE_ENTRIES = 10_000;
const MANAGED_BLOCK_START = "<!-- HUMANTHREAD:SKILLS:START -->";
const MANAGED_BLOCK_END = "<!-- HUMANTHREAD:SKILLS:END -->";

function filesystemError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function validateRelativePath(value: string): string {
  if (
    !value
    || value.startsWith("/")
    || value.includes("\\")
    || /^[a-z]:/iu.test(value)
    || value.split("/").some((part) => part === "" || part === "." || part === "..")
  ) throw filesystemError("workspace_scope_denied", `Invalid project-relative path: ${value}`);
  return value;
}

function isInside(root: string, target: string): boolean {
  return target === root || target.startsWith(`${root}${sep}`);
}

async function confinedPath(root: string, relativePath: string): Promise<string> {
  const validated = validateRelativePath(relativePath);
  let cursor = root;
  for (const part of validated.split("/")) {
    cursor = join(cursor, part);
    try {
      if ((await lstat(cursor)).isSymbolicLink()) {
        throw filesystemError("workspace_scope_denied", "Symlinks are forbidden in local Loop configuration");
      }
    } catch (error) {
      if (!error || typeof error !== "object" || Reflect.get(error, "code") !== "ENOENT") throw error;
      break;
    }
  }
  const target = resolve(root, ...validated.split("/"));
  if (!isInside(root, target)) throw filesystemError("workspace_scope_denied", "Path is outside the Git project");
  let ancestor = target;
  const suffix: string[] = [];
  while (true) {
    try {
      await lstat(ancestor);
      break;
    } catch (error) {
      if (!error || typeof error !== "object" || Reflect.get(error, "code") !== "ENOENT") throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) throw filesystemError("workspace_scope_denied", "Path has no project ancestor");
      suffix.unshift(ancestor.slice(parent.length + 1));
      ancestor = parent;
    }
  }
  const ancestorRealpath = await realpath(ancestor);
  if (!isInside(root, ancestorRealpath)) throw filesystemError("workspace_scope_denied", "Path resolves outside the Git project");
  return join(ancestorRealpath, ...suffix);
}

function isGeneratedProjection(path: string): boolean {
  return path === ".humanthread/structure/manifest.json"
    || path === ".humanthread/structure/lock.json"
    || path === ".humanthread/CONFIGURATION.md"
    || /^\.humanthread\/loops\/[^/]+\/loop\.yaml$/u.test(path);
}

function withoutManagedBlock(content: string): string | null {
  const start = content.indexOf(MANAGED_BLOCK_START);
  if (start < 0 || content.indexOf(MANAGED_BLOCK_START, start + MANAGED_BLOCK_START.length) >= 0) return null;
  const end = content.indexOf(MANAGED_BLOCK_END, start + MANAGED_BLOCK_START.length);
  if (end < 0 || content.indexOf(MANAGED_BLOCK_END, end + MANAGED_BLOCK_END.length) >= 0) return null;
  const afterEnd = end + MANAGED_BLOCK_END.length;
  const removeUntil = content.startsWith("\r\n", afterEnd) ? afterEnd + 2 : content.startsWith("\n", afterEnd) ? afterEnd + 1 : afterEnd;
  return `${content.slice(0, start)}${content.slice(removeUntil)}`;
}

function validMigrationMove(from: string, to: string): boolean {
  if (!/^\.humanthread\/loops\/.+\/nodes\/.+$/u.test(from)) return false;
  const match = /^\.humanthread\/runtime\/sync\/([A-Za-z0-9_-]{1,128})\/backup\/(.+)$/u.exec(to);
  return match !== null && match[2] === from.slice(".humanthread/".length);
}

export async function resolveGitRoot(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd });
    return realpath(stdout.trim());
  } catch {
    throw filesystemError("git_project_required", "ht must run inside a Git project");
  }
}

export function createNodeProjectFilesystem(root: string): ProjectLoopSyncFilesystem {
  const readText = async (path: string): Promise<string | null> => {
    const target = await confinedPath(root, path);
    try {
      const metadata = await lstat(target);
      if (!metadata.isFile() || metadata.size > MAX_FILE_BYTES) throw filesystemError("local_file_invalid", `Local file is invalid or too large: ${path}`);
      return readFile(target, "utf8");
    } catch (error) {
      if (error && typeof error === "object" && Reflect.get(error, "code") === "ENOENT") return null;
      throw error;
    }
  };
  return {
    readText,
    async listTree(path) {
      const target = await confinedPath(root, path);
      try { await access(target); } catch { return []; }
      const files: string[] = [];
      const visit = async (directory: string): Promise<void> => {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          if (entry.isSymbolicLink()) throw filesystemError("workspace_scope_denied", "Symlinks are forbidden in local Loop configuration");
          const absolute = join(directory, entry.name);
          if (entry.isDirectory()) await visit(absolute);
          else if (entry.isFile()) files.push(relative(root, absolute).split(sep).join("/"));
          if (files.length > MAX_TREE_ENTRIES) throw filesystemError("local_tree_too_large", "Local Loop configuration has too many files");
        }
      };
      await visit(target);
      return files.sort();
    },
    async mkdir(path) { await mkdir(await confinedPath(root, path), { recursive: true }); },
    async writeTextExclusive(path, content) {
      if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) {
        throw filesystemError("local_file_invalid", `Local file is too large: ${path}`);
      }
      const target = await confinedPath(root, path);
      await mkdir(dirname(target), { recursive: true });
      const handle = await open(target, "wx");
      try { await handle.writeFile(content, "utf8"); await handle.sync(); } finally { await handle.close(); }
    },
    async writeTextAtomic(path, content) {
      if (!isGeneratedProjection(path) && path !== "CLAUDE.md") {
        throw filesystemError("atomic_write_denied", `Atomic replacement is forbidden for project-owned file: ${path}`);
      }
      if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) throw filesystemError("local_file_invalid", `Local file is too large: ${path}`);
      const target = await confinedPath(root, path);
      if (path === "CLAUDE.md") {
        const nextOutside = withoutManagedBlock(content);
        if (nextOutside === null) throw filesystemError("atomic_write_denied", "CLAUDE.md replacement requires one HumanThread managed block");
        let current = "";
        try { current = await readFile(target, "utf8"); } catch (error) {
          if (!error || typeof error !== "object" || Reflect.get(error, "code") !== "ENOENT") throw error;
        }
        const currentOutside = withoutManagedBlock(current) ?? current;
        if (nextOutside !== currentOutside) {
          throw filesystemError("atomic_write_denied", "CLAUDE.md content outside the HumanThread managed block must remain unchanged");
        }
      }
      await mkdir(dirname(target), { recursive: true });
      const temporary = `${target}.${randomUUID()}.tmp`;
      const handle = await open(temporary, "wx");
      try { await handle.writeFile(content, "utf8"); await handle.sync(); } finally { await handle.close(); }
      await rename(temporary, target);
    },
    async renameExclusive(from, to) {
      if (!validMigrationMove(from, to)) {
        throw filesystemError("workspace_scope_denied", "Only a v1 node directory may move to its matching Loop sync backup");
      }
      const source = await confinedPath(root, from);
      const target = await confinedPath(root, to);
      await mkdir(dirname(target), { recursive: true });
      try {
        await lstat(target);
        throw filesystemError("path_exists", `Migration backup already exists: ${to}`);
      } catch (error) {
        if (!error || typeof error !== "object" || Reflect.get(error, "code") !== "ENOENT") throw error;
      }
      await rename(source, target);
    },
    async removeTransactionTree(path) {
      if (!/^\.humanthread\/runtime\/sync\/[A-Za-z0-9_-]{1,128}$/u.test(path)) {
        throw filesystemError("workspace_scope_denied", "Only a specific Loop sync transaction may be removed");
      }
      await rm(await confinedPath(root, path), { recursive: true, force: true });
    },
  };
}
