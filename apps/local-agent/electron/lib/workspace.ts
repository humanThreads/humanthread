import { spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from "node:fs";
import { dirname, extname, isAbsolute, join, parse, relative, sep } from "node:path";

import { buildManagedCommand, killProcessTree } from "./core";

export interface WorkspacePathResolution {
  workspaceRealpath: string;
  targetRealpath: string;
  contained: boolean;
}

export interface WorkspaceGitIdentity {
  workspaceRealpath: string;
  targetRealpath: string;
  branch: string;
  headCommit: string;
  clean: boolean;
  isWorktree: boolean;
}

export interface ValidatedWorkspaceDirectory {
  absolutePath: string;
  realpath: string;
}

export interface StageCheckResult {
  passed: boolean;
  summary: string;
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    Reflect.get(error, "code") === "ENOENT"
  );
}

function splitAbsolutePath(value: string): { root: string; parts: string[] } {
  const root = parse(value).root;
  const withoutRoot = value.slice(root.length);
  const parts = withoutRoot.split(process.platform === "win32" ? /[\\/]+/u : /\/+/u)
    .filter((part) => part.length > 0 && part !== ".");
  return { root, parts };
}

function joinParts(root: string, parts: string[]): string {
  if (parts.length === 0) return root;
  const suffix = parts.join(sep);
  if (root.endsWith(sep)) return `${root}${suffix}`;
  return `${root}${sep}${suffix}`;
}

export function validateWorkspaceDirectoryImpl(path: string): ValidatedWorkspaceDirectory {
  if (!isAbsolute(path)) {
    throw new Error("Project Workspace path must be absolute");
  }
  if (path.length > 4_096 || /[\u0000-\u001F\u007F]/u.test(path)) {
    throw new Error("Project Workspace path is invalid");
  }
  let realpath: string;
  try {
    realpath = realpathSync(path);
  } catch (error) {
    throw new Error(`Failed to resolve project Workspace: ${(error as Error).message}`);
  }
  if (!statSync(realpath).isDirectory()) {
    throw new Error("Project Workspace must be a directory");
  }
  return { absolutePath: path, realpath };
}

export function resolveWorkspacePathImpl(
  workspaceRoot: string,
  requestedPath: string,
): WorkspacePathResolution {
  if (!isAbsolute(workspaceRoot) || !isAbsolute(requestedPath)) {
    throw new Error("Workspace paths must be absolute");
  }

  let workspaceRealpath: string;
  try {
    workspaceRealpath = realpathSync(workspaceRoot);
  } catch (error) {
    throw new Error(`Failed to resolve project Workspace: ${(error as Error).message}`);
  }
  if (!statSync(workspaceRealpath).isDirectory()) {
    throw new Error("Project Workspace must be a directory");
  }

  const { root, parts } = splitAbsolutePath(requestedPath);
  let remaining = [...parts];
  const missingSuffix: string[] = [];
  for (;;) {
    const candidate = joinParts(root, remaining);
    try {
      lstatSync(candidate);
      break;
    } catch (error) {
      if (!isNotFound(error)) {
        throw new Error(`Failed to inspect requested Workspace path: ${(error as Error).message}`);
      }
      const component = remaining[remaining.length - 1];
      if (component === undefined) {
        throw new Error("Requested Workspace path has no existing ancestor");
      }
      if (component === "..") {
        throw new Error("Parent traversal is forbidden in unresolved Workspace paths");
      }
      missingSuffix.push(component);
      remaining = remaining.slice(0, -1);
    }
  }

  const existingAncestor = joinParts(root, remaining);
  if (missingSuffix.length > 0 && !statSync(existingAncestor).isDirectory()) {
    throw new Error("Unresolved Workspace path must descend from a directory");
  }
  let targetRealpath: string;
  try {
    targetRealpath = realpathSync(existingAncestor);
  } catch (error) {
    throw new Error(`Failed to resolve requested Workspace path: ${(error as Error).message}`);
  }
  for (const component of missingSuffix.reverse()) {
    targetRealpath = join(targetRealpath, component);
  }

  const relativePath = relative(workspaceRealpath, targetRealpath);
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error("Resolved path is outside the project Workspace");
  }

  return { workspaceRealpath, targetRealpath, contained: true };
}

export function workspaceRelativePath(workspaceRealpath: string, target: string): string {
  const relativePath = relative(workspaceRealpath, target);
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error("Workspace target is outside the project");
  }
  if (relativePath === "") return "";
  return relativePath.split(sep).join("/");
}

interface GitOutput {
  status: number | null;
  stdout: string;
}

function runGit(cwd: string, args: string[]): GitOutput {
  const result = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw new Error(`Failed to run Git: ${result.error.message}`);
  return { status: result.status, stdout: result.stdout ?? "" };
}

function runGitChecked(cwd: string, args: string[], failure: string): string {
  const output = runGit(cwd, args);
  if (output.status !== 0) {
    throw new Error(failure);
  }
  return output.stdout;
}

function gitRefExists(cwd: string, reference: string): boolean {
  const result = spawnSync("git", ["-C", cwd, "show-ref", "--verify", "--quiet", reference], {
    stdio: "ignore",
  });
  if (result.error) throw new Error(`Failed to inspect Git ref: ${result.error.message}`);
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new Error("Git ref inspection failed");
}

export function inspectWorkspaceGitImpl(
  workspaceRoot: string,
  requestedPath: string,
): WorkspaceGitIdentity {
  const resolution = resolveWorkspacePathImpl(workspaceRoot, requestedPath);
  const workspaceRealpath = resolution.workspaceRealpath;
  let targetRealpath: string;
  try {
    targetRealpath = realpathSync(resolution.targetRealpath);
  } catch (error) {
    throw new Error(`Failed to resolve Git worktree: ${(error as Error).message}`);
  }
  if (!statSync(targetRealpath).isDirectory()) {
    throw new Error("Git worktree path must be a directory");
  }

  const identityOutput = runGit(targetRealpath, ["rev-parse", "--show-toplevel", "--abbrev-ref", "HEAD"]);
  if (identityOutput.status !== 0) {
    throw new Error("Requested path is not a Git worktree");
  }
  const identityLines = identityOutput.stdout.split("\n").map((line) => line.trim());
  while (identityLines.length > 0 && identityLines[identityLines.length - 1] === "") identityLines.pop();
  if (identityLines.length !== 2 || identityLines.some((value) => value.length === 0)) {
    throw new Error("Git worktree identity is incomplete");
  }
  const gitTopLevelRaw = identityLines[0] as string;
  const branch = identityLines[1] as string;
  let gitTopLevel: string;
  try {
    gitTopLevel = realpathSync(gitTopLevelRaw);
  } catch (error) {
    throw new Error(`Failed to resolve Git worktree root: ${(error as Error).message}`);
  }
  if (gitTopLevel !== targetRealpath) {
    throw new Error("Git worktree root does not match the requested path");
  }

  const gitDirsOutput = runGit(targetRealpath, ["rev-parse", "--git-common-dir", "--git-dir"]);
  if (gitDirsOutput.status !== 0) {
    throw new Error("Git directory identity could not be read");
  }
  const gitDirLines = gitDirsOutput.stdout.split("\n").map((line) => line.trim());
  while (gitDirLines.length > 0 && gitDirLines[gitDirLines.length - 1] === "") gitDirLines.pop();
  if (gitDirLines.length !== 2 || gitDirLines.some((value) => value.length === 0)) {
    throw new Error("Git directory identity is incomplete");
  }
  const resolveGitDir = (value: string): string => {
    const candidate = isAbsolute(value) ? value : join(targetRealpath, value);
    try {
      return realpathSync(candidate);
    } catch (error) {
      throw new Error(`Failed to resolve Git directory identity: ${(error as Error).message}`);
    }
  };
  const gitCommonDir = resolveGitDir(gitDirLines[0] as string);
  const gitDir = resolveGitDir(gitDirLines[1] as string);
  let expectedCommonDir: string;
  try {
    expectedCommonDir = realpathSync(join(workspaceRealpath, ".git"));
  } catch (error) {
    throw new Error(`Failed to resolve Workspace Git directory: ${(error as Error).message}`);
  }
  if (gitCommonDir !== expectedCommonDir) {
    throw new Error("Git worktree is not linked to the requested Workspace");
  }

  const headOutput = runGit(targetRealpath, ["rev-parse", "--verify", "HEAD^{commit}"]);
  if (headOutput.status !== 0) {
    throw new Error("Git HEAD could not be resolved");
  }
  const headCommit = headOutput.stdout.trim();
  if (
    branch === "HEAD" ||
    branch.length > 191 ||
    /[\u0000-\u001F\u007F]/u.test(branch) ||
    !/^[0-9a-fA-F]+$/u.test(headCommit) ||
    headCommit.length < 40 ||
    headCommit.length > 64
  ) {
    throw new Error("Git worktree branch or HEAD is invalid");
  }

  const statusOutput = runGit(targetRealpath, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (statusOutput.status !== 0) {
    throw new Error("Git worktree status could not be read");
  }

  return {
    workspaceRealpath,
    targetRealpath,
    branch,
    headCommit,
    clean: statusOutput.stdout.length === 0,
    isWorktree: targetRealpath !== workspaceRealpath && gitDir !== gitCommonDir,
  };
}

export function validTaskBranch(value: string): boolean {
  return /^\d{4}-[A-Za-z0-9_-]+$/u.test(value) && value.length >= 6 && value.length <= 191;
}

export function prepareTaskWorktreeImpl(
  workspaceRoot: string,
  taskBranch: string,
  baseBranch: string,
): WorkspaceGitIdentity {
  if (
    !validTaskBranch(taskBranch) ||
    baseBranch.length === 0 ||
    baseBranch.length > 191 ||
    baseBranch.startsWith("-") ||
    /[\u0000-\u001F\u007F]/u.test(baseBranch)
  ) {
    throw new Error("Task worktree branch input is invalid");
  }
  const rootResolution = resolveWorkspacePathImpl(workspaceRoot, workspaceRoot);
  const workspaceRealpath = rootResolution.workspaceRealpath;
  inspectWorkspaceGitImpl(workspaceRealpath, workspaceRealpath);
  runGitChecked(workspaceRealpath, ["check-ref-format", "--branch", taskBranch], "Task branch is invalid");
  runGitChecked(workspaceRealpath, ["check-ref-format", "--branch", baseBranch], "Task base branch is invalid");
  runGitChecked(workspaceRealpath, ["check-ignore", "-q", "--", ".worktrees/"], "Task worktree directory must be ignored by Git");

  const requestedTarget = join(workspaceRealpath, ".worktrees", taskBranch);
  const targetResolution = resolveWorkspacePathImpl(workspaceRealpath, requestedTarget);
  const targetPath = targetResolution.targetRealpath;
  let targetExists = true;
  try {
    lstatSync(targetPath);
  } catch (error) {
    if (!isNotFound(error)) throw error;
    targetExists = false;
  }
  if (targetExists) {
    const identity = inspectWorkspaceGitImpl(workspaceRealpath, targetPath);
    if (identity.branch !== taskBranch || !identity.isWorktree) {
      throw new Error("Task worktree checkout does not match the assignment");
    }
    return identity;
  }

  runGitChecked(workspaceRealpath, ["fetch", "--prune", "origin"], "Failed to fetch task worktree refs");
  const localRef = `refs/heads/${taskBranch}`;
  const remoteRef = `refs/remotes/origin/${taskBranch}`;
  const remoteTask = `origin/${taskBranch}`;
  const remoteBase = `origin/${baseBranch}`;
  runGitChecked(
    workspaceRealpath,
    ["rev-parse", "--verify", "--end-of-options", `${remoteBase}^{commit}`],
    "Task base branch did not resolve to a remote commit",
  );
  const worktreeOutput = runGitChecked(
    workspaceRealpath,
    ["worktree", "list", "--porcelain"],
    "Failed to inspect task worktree registrations",
  );
  let legacyPath: string | null = null;
  for (const entry of worktreeOutput.split("\n\n")) {
    const entryPath = entry.split("\n").find((line) => line.startsWith("worktree "))?.slice("worktree ".length);
    const entryBranch = entry.split("\n").find((line) => line.startsWith("branch refs/heads/"))?.slice("branch refs/heads/".length);
    if (entryBranch === taskBranch && entryPath !== undefined && entryPath !== targetPath) {
      legacyPath = entryPath;
      break;
    }
  }
  if (legacyPath !== null) {
    runGitChecked(workspaceRealpath, ["worktree", "move", legacyPath, targetPath], "Failed to move the task worktree to its canonical path");
    const identity = inspectWorkspaceGitImpl(workspaceRealpath, targetPath);
    if (identity.branch !== taskBranch || !identity.isWorktree) {
      throw new Error("Prepared task worktree checkout does not match the assignment");
    }
    return identity;
  }
  if (gitRefExists(workspaceRealpath, localRef)) {
    runGitChecked(workspaceRealpath, ["worktree", "add", targetPath, taskBranch], "Failed to attach the existing task branch worktree");
  } else if (gitRefExists(workspaceRealpath, remoteRef)) {
    runGitChecked(workspaceRealpath, ["worktree", "add", "-b", taskBranch, targetPath, remoteTask], "Failed to attach the remote task branch worktree");
  } else {
    runGitChecked(workspaceRealpath, ["worktree", "add", "-b", taskBranch, targetPath, remoteBase], "Failed to create the task branch worktree");
  }

  const identity = inspectWorkspaceGitImpl(workspaceRealpath, targetPath);
  if (identity.branch !== taskBranch || !identity.isWorktree) {
    throw new Error("Prepared task worktree identity is invalid");
  }
  return identity;
}

export function readWorkspaceFileImpl(
  workspaceRoot: string,
  requestedPath: string,
  maxBytes: number,
): string | null {
  if (!Number.isInteger(maxBytes) || maxBytes <= 0 || maxBytes > 1_048_576) {
    throw new Error("Workspace read limit must be between 1 byte and 1 MiB");
  }
  const resolution = resolveWorkspacePathImpl(workspaceRoot, requestedPath);
  let metadata;
  try {
    metadata = statSync(resolution.targetRealpath);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw new Error(`Failed to inspect Workspace file: ${(error as Error).message}`);
  }
  if (!metadata.isFile()) {
    throw new Error("Requested Workspace path is not a file");
  }
  if (metadata.size > maxBytes) {
    throw new Error("Workspace file exceeds the requested read limit");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(resolution.targetRealpath));
  } catch (error) {
    throw new Error(`Failed to read Workspace file: ${(error as Error).message}`);
  }
}

export async function runWorkspaceCheckImpl(input: {
  workspaceRoot: string;
  command: string;
  timeoutMs: number;
}): Promise<StageCheckResult> {
  const { command, timeoutMs } = input;
  if (command.length === 0 || command.length > 2_048 || /[\u0000-\u001F\u007F]/u.test(command)) {
    throw new Error("Stage check command is invalid");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 600_000) {
    throw new Error("Stage check timeout must be between 1 second and 10 minutes");
  }
  const resolution = resolveWorkspacePathImpl(input.workspaceRoot, input.workspaceRoot);
  const spec = buildManagedCommand(resolution.workspaceRealpath, command);
  const child = spawn(spec.program, spec.args, {
    cwd: spec.cwd,
    stdio: "ignore",
    detached: process.platform !== "win32",
    windowsHide: true,
  });
  const outcome = await new Promise<
    { kind: "exit"; code: number | null } | { kind: "timeout" } | { kind: "error"; message: string }
  >((resolvePromise) => {
    const timeout = setTimeout(() => {
      if (child.pid !== undefined) killProcessTree(child.pid);
      try {
        child.kill("SIGKILL");
      } catch {
        // The process may have exited between the timer and the kill.
      }
      resolvePromise({ kind: "timeout" });
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timeout);
      resolvePromise({ kind: "error", message: error.message });
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      resolvePromise({ kind: "exit", code });
    });
  });
  if (outcome.kind === "error") {
    throw new Error(`Failed to start Stage check: ${outcome.message}`);
  }
  if (outcome.kind === "timeout") {
    return { passed: false, summary: "Stage check timed out" };
  }
  return {
    passed: outcome.code === 0,
    summary: outcome.code === 0
      ? "Stage check passed"
      : `Stage check failed with exit code ${outcome.code === null ? "unknown" : String(outcome.code)}`,
  };
}

function temporarySiblingPath(target: string): string {
  const extension = extname(target);
  const base = extension.length > 0 ? target.slice(0, -extension.length) : target;
  return `${base}.${process.pid}.tmp`;
}

function createExclusiveFile(path: string, content: string, failure: string): void {
  let descriptor: number;
  try {
    descriptor = openSync(path, "wx");
  } catch (error) {
    throw new Error(`${failure}: ${(error as Error).message}`);
  }
  try {
    writeSync(descriptor, content);
    fsyncSync(descriptor);
  } catch (error) {
    closeSync(descriptor);
    rmSync(path, { force: true });
    throw new Error(`${failure}: ${(error as Error).message}`);
  }
  closeSync(descriptor);
}

export function writeWorkspaceFileImpl(
  workspaceRoot: string,
  requestedPath: string,
  content: string,
): string {
  if (Buffer.byteLength(content, "utf8") > 1_048_576) {
    throw new Error("Workspace file exceeds 1 MiB");
  }
  const resolution = resolveWorkspacePathImpl(workspaceRoot, requestedPath);
  const target = resolution.targetRealpath;
  const parent = dirname(target);
  if (parent === target) throw new Error("Workspace file has no parent");
  try {
    mkdirSync(parent, { recursive: true });
  } catch (error) {
    throw new Error(`Failed to create Workspace file directory: ${(error as Error).message}`);
  }
  const verified = resolveWorkspacePathImpl(resolution.workspaceRealpath, target);
  const verifiedTarget = verified.targetRealpath;
  const temporary = temporarySiblingPath(verifiedTarget);
  createExclusiveFile(temporary, content, "Failed to create temporary Workspace file");
  try {
    renameSync(temporary, verifiedTarget);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw new Error(`Failed to publish Workspace file: ${(error as Error).message}`);
  }
  return verifiedTarget;
}

export function createWorkspaceDirectoryImpl(workspaceRoot: string, requestedPath: string): string {
  const resolution = resolveWorkspacePathImpl(workspaceRoot, requestedPath);
  try {
    mkdirSync(resolution.targetRealpath, { recursive: true });
  } catch (error) {
    throw new Error(`Failed to create Workspace directory: ${(error as Error).message}`);
  }
  const verified = resolveWorkspacePathImpl(resolution.workspaceRealpath, resolution.targetRealpath);
  return verified.targetRealpath;
}

export function createWorkspaceFileImpl(
  workspaceRoot: string,
  requestedPath: string,
  content: string,
): string {
  if (Buffer.byteLength(content, "utf8") > 1_048_576) {
    throw new Error("Workspace file exceeds 1 MiB");
  }
  const resolution = resolveWorkspacePathImpl(workspaceRoot, requestedPath);
  const target = resolution.targetRealpath;
  const parent = dirname(target);
  if (parent === target) throw new Error("Workspace file has no parent");
  try {
    mkdirSync(parent, { recursive: true });
  } catch (error) {
    throw new Error(`Failed to create Workspace file directory: ${(error as Error).message}`);
  }
  const verified = resolveWorkspacePathImpl(resolution.workspaceRealpath, target);
  createExclusiveFile(verified.targetRealpath, content, "Failed to create exclusive Workspace file");
  return verified.targetRealpath;
}

function withoutManagedBlock(value: string): string | null {
  const START = "<!-- HUMANTHREAD:SKILLS:START -->";
  const END = "<!-- HUMANTHREAD:SKILLS:END -->";
  const start = value.indexOf(START);
  if (start < 0) return null;
  if (value.slice(start + START.length).includes(START)) return null;
  const relativeEnd = value.slice(start + START.length).indexOf(END);
  if (relativeEnd < 0) return null;
  const end = start + START.length + relativeEnd;
  if (value.slice(end + END.length).includes(END)) return null;
  let after = end + END.length;
  if (value.slice(after).startsWith("\r\n")) after += 2;
  else if (value.slice(after).startsWith("\n")) after += 1;
  return `${value.slice(0, start)}${value.slice(after)}`;
}

export function replaceWorkspaceStructureFileImpl(
  workspaceRoot: string,
  requestedPath: string,
  content: string,
): string {
  const resolution = resolveWorkspacePathImpl(workspaceRoot, requestedPath);
  const relativePath = workspaceRelativePath(resolution.workspaceRealpath, resolution.targetRealpath);
  const parts = relativePath.split("/");
  const generatedProjection =
    relativePath === ".humanthread/structure/manifest.json" ||
    relativePath === ".humanthread/structure/lock.json" ||
    relativePath === ".humanthread/CONFIGURATION.md" ||
    (parts.length === 4 && parts[0] === ".humanthread" && parts[1] === "loops" && parts[3] === "loop.yaml");
  if (!generatedProjection && relativePath !== "CLAUDE.md") {
    throw new Error("Atomic replacement is limited to HumanThread structure files");
  }
  if (relativePath === "CLAUDE.md") {
    const nextOutside = withoutManagedBlock(content);
    if (nextOutside === null) {
      throw new Error("CLAUDE.md replacement requires one HumanThread managed block");
    }
    let current = "";
    try {
      current = readFileSync(resolution.targetRealpath, "utf8");
    } catch (error) {
      if (!isNotFound(error)) {
        throw new Error(`Failed to read CLAUDE.md: ${(error as Error).message}`);
      }
    }
    const currentOutside = withoutManagedBlock(current) ?? current;
    if (nextOutside !== currentOutside) {
      throw new Error("CLAUDE.md content outside the HumanThread managed block must remain unchanged");
    }
  }
  return writeWorkspaceFileImpl(workspaceRoot, requestedPath, content);
}

export function listWorkspaceTreeImpl(
  workspaceRoot: string,
  requestedPath: string,
  maxEntries: number,
): string[] {
  if (!Number.isInteger(maxEntries) || maxEntries <= 0 || maxEntries > 10_000) {
    throw new Error("Workspace tree limit must be between 1 and 10000 entries");
  }
  const resolution = resolveWorkspacePathImpl(workspaceRoot, requestedPath);
  const workspaceRealpath = resolution.workspaceRealpath;
  const target = resolution.targetRealpath;
  let metadata;
  try {
    metadata = lstatSync(target);
  } catch (error) {
    if (isNotFound(error)) return [];
    throw new Error(`Failed to inspect Workspace tree: ${(error as Error).message}`);
  }
  if (metadata.isSymbolicLink()) {
    throw new Error("Symlinks are forbidden in local Loop configuration");
  }
  const files: string[] = [];
  const directories: string[] = metadata.isDirectory() ? [target] : [];
  if (metadata.isFile()) {
    files.push(workspaceRelativePath(workspaceRealpath, target));
  }
  while (directories.length > 0) {
    const directory = directories.pop() as string;
    let entries;
    try {
      entries = readdirSync(directory);
    } catch (error) {
      throw new Error(`Failed to read Workspace tree: ${(error as Error).message}`);
    }
    for (const entry of entries) {
      const entryPath = join(directory, entry);
      let entryMetadata;
      try {
        entryMetadata = lstatSync(entryPath);
      } catch (error) {
        throw new Error(`Failed to inspect Workspace tree entry: ${(error as Error).message}`);
      }
      if (entryMetadata.isSymbolicLink()) {
        throw new Error("Symlinks are forbidden in local Loop configuration");
      }
      if (entryMetadata.isDirectory()) {
        directories.push(entryPath);
      } else if (entryMetadata.isFile()) {
        files.push(workspaceRelativePath(workspaceRealpath, entryPath));
        if (files.length > maxEntries) {
          throw new Error("Workspace tree exceeds the requested entry limit");
        }
      }
    }
  }
  files.sort();
  return files;
}

export function validSyncTransactionId(value: string): boolean {
  return value.length > 0 && value.length <= 128 && /^[A-Za-z0-9_-]+$/u.test(value);
}

export function renameWorkspaceLoopPathImpl(
  workspaceRoot: string,
  fromPath: string,
  toPath: string,
): string {
  const source = resolveWorkspacePathImpl(workspaceRoot, fromPath);
  const target = resolveWorkspacePathImpl(workspaceRoot, toPath);
  const workspace = source.workspaceRealpath;
  const fromRelative = workspaceRelativePath(workspace, source.targetRealpath);
  const toRelative = workspaceRelativePath(workspace, target.targetRealpath);
  const fromParts = fromRelative.split("/");
  const toParts = toRelative.split("/");
  const nodesIndex = fromParts.indexOf("nodes");
  if (fromParts.length < 5 || fromParts[0] !== ".humanthread" || fromParts[1] !== "loops" || nodesIndex < 0) {
    throw new Error("Only a v1 node directory may be migrated");
  }
  if (
    toParts.length < 7 ||
    toParts[0] !== ".humanthread" ||
    toParts[1] !== "runtime" ||
    toParts[2] !== "sync" ||
    !validSyncTransactionId(toParts[3] as string) ||
    toParts[4] !== "backup" ||
    toParts.slice(5).join("/") !== fromParts.slice(1).join("/")
  ) {
    throw new Error("Migration backup must match the v1 node path");
  }
  const sourcePath = source.targetRealpath;
  if (lstatSync(sourcePath).isSymbolicLink()) {
    throw new Error("Symlinks are forbidden in local Loop configuration");
  }
  const targetPath = target.targetRealpath;
  try {
    lstatSync(targetPath);
    throw new Error("Migration backup already exists");
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  try {
    mkdirSync(dirname(targetPath), { recursive: true });
  } catch (error) {
    throw new Error(`Failed to create migration backup directory: ${(error as Error).message}`);
  }
  try {
    renameSync(sourcePath, targetPath);
  } catch (error) {
    throw new Error(`Failed to move v1 node to migration backup: ${(error as Error).message}`);
  }
  return targetPath;
}

export function removeWorkspaceSyncTransactionImpl(
  workspaceRoot: string,
  requestedPath: string,
): void {
  const resolution = resolveWorkspacePathImpl(workspaceRoot, requestedPath);
  const relativePath = workspaceRelativePath(resolution.workspaceRealpath, resolution.targetRealpath);
  const parts = relativePath.split("/");
  if (
    parts.length !== 4 ||
    parts[0] !== ".humanthread" ||
    parts[1] !== "runtime" ||
    parts[2] !== "sync" ||
    !validSyncTransactionId(parts[3] as string)
  ) {
    throw new Error("Only a specific Loop sync transaction may be removed");
  }
  const target = resolution.targetRealpath;
  let metadata;
  try {
    metadata = lstatSync(target);
  } catch (error) {
    if (isNotFound(error)) return;
    throw new Error(`Failed to inspect Loop sync transaction: ${(error as Error).message}`);
  }
  if (metadata.isSymbolicLink()) {
    throw new Error("Symlinks are forbidden in local Loop configuration");
  }
  try {
    rmSync(target, { recursive: true, force: true });
  } catch (error) {
    throw new Error(`Failed to remove Loop sync transaction: ${(error as Error).message}`);
  }
}
