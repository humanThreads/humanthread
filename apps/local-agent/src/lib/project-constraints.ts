import { parseDocument } from "yaml";
import { z } from "zod";

import { getNativeBridge } from "./native-bridge";
import {
  assertPathInsideWorkspace,
  type NativeWorkspacePathResolver,
  resolveWorkspaceBoundary,
  workspaceRelativePath,
} from "./workspace-policy";

const MAX_CONSTRAINT_FILES = 64;
const MAX_CONSTRAINT_FILE_BYTES = 64 * 1_024;
const MAX_CONSTRAINT_BUNDLE_BYTES = 64 * 1_024;

const relativeConstraintPathSchema = z.string().min(1).max(1_024).refine((value) => {
  try {
    workspaceRelativePath("/workspace", value);
    return value !== ".";
  } catch {
    return false;
  }
}, "Constraint source must be a project-relative file path");

const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  constraints: z.object({
    sources: z.array(relativeConstraintPathSchema).max(MAX_CONSTRAINT_FILES).default([]),
    hierarchical: z.object({
      enabled: z.boolean().default(true),
      filename: z.literal("AGENTS.md").default("AGENTS.md"),
    }).strict().default({ enabled: true, filename: "AGENTS.md" }),
    checks: z.array(z.string().trim().min(1).max(2_048)).max(32).default([]),
  }).strict().default({
    sources: [],
    hierarchical: { enabled: true, filename: "AGENTS.md" },
    checks: [],
  }),
}).strict();

export type ConstraintSource = { relativePath: string; content: string };
export type ConstraintCheck = { name: string; command: string };
export type ConstraintBundle = {
  sources: ConstraintSource[];
  checks: ConstraintCheck[];
  fingerprint: `sha256:${string}`;
};

export type ProjectConstraintDependencies = {
  resolveNativePath: NativeWorkspacePathResolver;
  readFile(input: {
    workspaceRoot: string;
    relativePath: string;
    requestedPath: string;
    maxBytes: number;
  }): Promise<string | null>;
};

function nativeInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const bridge = getNativeBridge();
  if (!bridge) {
    throw new Error("本地系统动作仅在桌面客户端中可用。");
  }
  return bridge.invoke<T>(command, args);
}

const defaultDependencies: ProjectConstraintDependencies = {
  resolveNativePath: (workspaceRoot, requestedPath) => resolveWorkspaceBoundary({
    workspaceRoot,
    requestedPath,
    invoke: nativeInvoke,
  }),
  readFile: async ({ workspaceRoot, requestedPath, maxBytes }) => {
    const value = await nativeInvoke<string | null>("read_workspace_file", {
      workspaceRoot,
      requestedPath,
      maxBytes,
    });
    if (value === null) return null;
    if (typeof value !== "string") throw new Error("Native constraint file result is invalid");
    return value;
  },
};

function constraintError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function parseManifest(content: string | null) {
  if (content === null) return manifestSchema.parse({ schemaVersion: 1, constraints: {} });
  if (new TextEncoder().encode(content).byteLength > MAX_CONSTRAINT_FILE_BYTES) {
    throw constraintError("constraint_bundle_too_large", "humanthread.yaml exceeds the local constraint file limit");
  }
  const document = parseDocument(content, { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw constraintError("invalid_constraint_manifest", "humanthread.yaml is not valid YAML");
  }
  try {
    return manifestSchema.parse(document.toJS({ maxAliasCount: 0 }));
  } catch (error) {
    if (error && typeof error === "object" && Reflect.get(error, "code") === "workspace_scope_denied") {
      throw error;
    }
    if (error instanceof z.ZodError && error.issues.some((issue) => issue.path.includes("sources"))) {
      throw constraintError("workspace_scope_denied", "Constraint source is outside the project Workspace");
    }
    throw constraintError("invalid_constraint_manifest", "humanthread.yaml does not match schemaVersion 1");
  }
}

function hierarchicalPaths(targetPaths: string[], filename: string): string[] {
  const paths = new Set<string>([filename]);
  for (const targetPath of targetPaths) {
    workspaceRelativePath("/workspace", targetPath);
    if (targetPath === ".") continue;
    const segments = targetPath.split("/");
    for (let index = 1; index <= segments.length; index += 1) {
      paths.add(`${segments.slice(0, index).join("/")}/${filename}`);
    }
  }
  return [...paths].sort((left, right) => {
    const depth = left.split("/").length - right.split("/").length;
    if (depth !== 0) return depth;
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

async function sha256(value: string): Promise<`sha256:${string}`> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function loadProjectConstraints(
  input: { workspaceRoot: string; targetPaths: string[] },
  dependencies: ProjectConstraintDependencies = defaultDependencies,
): Promise<ConstraintBundle> {
  if (input.targetPaths.length === 0 || input.targetPaths.length > 64) {
    throw constraintError("workspace_scope_denied", "Constraint target paths are invalid");
  }
  const workspaceRoot = await assertPathInsideWorkspace({
    workspaceRoot: input.workspaceRoot,
    requestedPath: input.workspaceRoot,
    resolveNativePath: dependencies.resolveNativePath,
  });

  const read = async (relativePath: string): Promise<string | null> => {
    const requestedPath = workspaceRelativePath(workspaceRoot, relativePath);
    await assertPathInsideWorkspace({ workspaceRoot, requestedPath, resolveNativePath: dependencies.resolveNativePath });
    const content = await dependencies.readFile({
      workspaceRoot,
      relativePath,
      requestedPath,
      maxBytes: MAX_CONSTRAINT_FILE_BYTES,
    });
    if (content !== null && new TextEncoder().encode(content).byteLength > MAX_CONSTRAINT_FILE_BYTES) {
      throw constraintError("constraint_bundle_too_large", `${relativePath} exceeds the local constraint file limit`);
    }
    return content;
  };

  const manifest = parseManifest(await read("humanthread.yaml"));
  const hierarchical = manifest.constraints.hierarchical.enabled
    ? hierarchicalPaths(input.targetPaths, manifest.constraints.hierarchical.filename)
    : [];
  const rootHierarchy = hierarchical.filter((path) => path === manifest.constraints.hierarchical.filename);
  const nestedHierarchy = hierarchical.filter((path) => path !== manifest.constraints.hierarchical.filename);
  const orderedPaths = [...new Set([
    ...rootHierarchy,
    ...manifest.constraints.sources,
    ...nestedHierarchy,
  ])];
  if (orderedPaths.length > MAX_CONSTRAINT_FILES) {
    throw constraintError("constraint_bundle_too_large", "Constraint bundle contains too many files");
  }

  const declared = new Set(manifest.constraints.sources);
  const sources: ConstraintSource[] = [];
  let totalBytes = 0;
  for (const relativePath of orderedPaths) {
    const content = await read(relativePath);
    if (content === null) {
      if (declared.has(relativePath)) {
        throw constraintError("constraint_source_missing", `Declared constraint source does not exist: ${relativePath}`);
      }
      continue;
    }
    totalBytes += new TextEncoder().encode(content).byteLength;
    if (totalBytes > MAX_CONSTRAINT_BUNDLE_BYTES) {
      throw constraintError("constraint_bundle_too_large", "Constraint bundle exceeds the local byte limit");
    }
    sources.push({ relativePath, content });
  }
  const checks = manifest.constraints.checks.map((command, index) => ({ name: `check-${index + 1}`, command }));
  const fingerprint = await sha256(JSON.stringify({ sources, checks }));
  return { sources, checks, fingerprint };
}

export function renderProjectConstraints(bundle: ConstraintBundle): string {
  if (bundle.sources.length === 0 && bundle.checks.length === 0) return "";
  const sources = bundle.sources.map(({ relativePath, content }) => (
    `### ${relativePath}\n${content}`
  )).join("\n\n");
  const checks = bundle.checks.length === 0
    ? ""
    : `\n\nRequired local checks:\n${bundle.checks.map(({ command }) => `- ${command}`).join("\n")}`;
  return `Project constraints (${bundle.fingerprint}):\n\n${sources}${checks}`;
}
