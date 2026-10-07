import { projectLoopCatalogV2Schema, type ProjectLoopCatalogV2 } from "./contracts";

type ExecutionStatus = "available" | "missing";

export type CredentialRequirement = {
  name: string;
  purpose: string;
  executionTargets: Array<"local_agent" | "worker">;
  projectSource: string | null;
  localAgent: { status: ExecutionStatus; source: "environment" | "project_file" | null };
  worker: { status: ExecutionStatus; source: "project_file" | null };
  validator: string;
};

export type CredentialRequirementsResult = {
  requirements: CredentialRequirement[];
  snapshot: `sha256:${string}`;
};

const ENV_NAME = /\b[A-Z][A-Z0-9_]{2,}\b/gu;
const ENV_FILE = /(?:^|\n)\s*([A-Za-z_][A-Za-z0-9_]*)\s*=([^\n]*)/gu;
const SECRET_NAME = /(?:KEY|TOKEN|SECRET|PASSWORD|COOKIE|DSN)$/u;

function selectedNodes(catalog: ProjectLoopCatalogV2): Array<{ label: string; responsibility?: string | undefined }> {
  const loops = new Map(catalog.publishedLoops.map((loop) => [loop.loopDefinitionId, loop]));
  const visited = new Set<string>();
  const result: Array<{ label: string; responsibility?: string }> = [];
  const visit = (loopId: string, versionId: string): void => {
    const key = `${loopId}::${versionId}`;
    if (visited.has(key)) return;
    visited.add(key);
    const loop = loops.get(loopId);
    const version = loop?.publishedVersions.find((item) => item.loopVersionId === versionId);
    if (!version) return;
    for (const node of version.graph.nodes) {
      if (node.type === "agent_action" || node.type === "platform_action") {
        result.push({ label: node.label, responsibility: node.responsibility });
      }
      if (node.type === "subloop_call") visit(node.targetLoopDefinitionId, node.targetLoopVersionId);
    }
  };
  for (const binding of catalog.projectBindings) {
    if (binding.status === "enabled") visit(binding.loopDefinitionId, binding.activeVersionId);
  }
  return result;
}

function selectedLoopIds(catalog: ProjectLoopCatalogV2): Set<string> {
  const loops = new Map(catalog.publishedLoops.map((loop) => [loop.loopDefinitionId, loop]));
  const visited = new Set<string>();
  const ids = new Set<string>();
  const visit = (loopId: string, versionId: string): void => {
    const key = `${loopId}::${versionId}`;
    if (visited.has(key)) return;
    visited.add(key);
    const loop = loops.get(loopId);
    const version = loop?.publishedVersions.find((item) => item.loopVersionId === versionId);
    if (!version) return;
    ids.add(loopId);
    for (const node of version.graph.nodes) {
      if (node.type === "subloop_call") visit(node.targetLoopDefinitionId, node.targetLoopVersionId);
    }
  };
  for (const binding of catalog.projectBindings) {
    if (binding.status === "enabled") visit(binding.loopDefinitionId, binding.activeVersionId);
  }
  return ids;
}

function parseProjectEnv(projectFiles: Record<string, string>): Map<string, string> {
  const values = new Map<string, string>();
  for (const [path, content] of Object.entries(projectFiles)) {
    if (!/(^|\/)(?:\.env(?:\.[^/]*)?|AGENTS\.md|CLAUDE\.md)$/u.test(path)) continue;
    for (const match of content.matchAll(ENV_FILE)) values.set(match[1]!, match[2]!.trim().replace(/^['"]|['"]$/gu, ""));
  }
  return values;
}

async function sha256(value: string): Promise<`sha256:${string}`> {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  ));
  return `sha256:${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function inferCredentialRequirements(input: {
  catalog: ProjectLoopCatalogV2;
  projectFiles: Record<string, string>;
  localEnvironment: Record<string, string | undefined>;
}): Promise<CredentialRequirementsResult> {
  const catalog = projectLoopCatalogV2Schema.parse(input.catalog);
  const projectFiles = { ...input.projectFiles };
  const projectValues = parseProjectEnv(projectFiles);
  const references = new Map<string, string>();
  for (const node of selectedNodes(catalog)) {
    const source = [node.label, node.responsibility].filter(Boolean).join(" ");
    for (const match of source.matchAll(ENV_NAME)) references.set(match[0]!, node.label);
  }
  const rules = Object.entries(projectFiles)
    .filter(([path]) => /(?:^|\/)(?:AGENTS\.md|CLAUDE\.md)$/u.test(path))
    .map(([, content]) => content)
    .join("\n");
  for (const match of rules.matchAll(ENV_NAME)) references.set(match[0]!, "项目规则");
  const selectedIds = selectedLoopIds(catalog);
  for (const [path, content] of Object.entries(projectFiles)) {
    if (!path.startsWith(".humanthread/loops/")) continue;
    if (![...selectedIds].some((id) => path.includes(`--${id}/`) || path.includes(`/${id}/`))) continue;
    for (const match of content.matchAll(ENV_NAME)) references.set(match[0]!, path);
  }

  const requirements = [...references.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([name, purpose]) => {
    const projectSource = projectValues.has(name)
      ? Object.keys(projectFiles).find((path) => projectFiles[path]!.match(new RegExp(`(?:^|\\n)\\s*${name}\\s*=`, "u"))) ?? null
      : null;
    const localAvailable = typeof input.localEnvironment[name] === "string" && input.localEnvironment[name]!.trim().length > 0;
    const projectAvailable = projectSource !== null;
    const localUsesProject = projectAvailable && SECRET_NAME.test(name);
    return {
      name,
      purpose,
      executionTargets: ["local_agent", "worker"],
      projectSource,
      localAgent: {
        status: localAvailable || localUsesProject ? "available" : "missing",
        source: localAvailable ? (localUsesProject ? "project_file" : "environment") : (localUsesProject ? "project_file" : null),
      },
      worker: { status: projectAvailable ? "available" : "missing", source: projectAvailable ? "project_file" : null },
      validator: "仅校验变量是否存在并记录脱敏指纹",
    } satisfies CredentialRequirement;
  });
  const snapshot = await sha256(JSON.stringify({
    projectId: catalog.projectId,
    catalogVersion: catalog.catalogVersion,
    requirements: requirements.map(({ name, purpose, projectSource, localAgent, worker }) => ({ name, purpose, projectSource, localAgent, worker })),
  }));
  return { requirements, snapshot };
}
