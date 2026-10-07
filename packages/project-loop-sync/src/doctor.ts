import Ajv2020 from "ajv/dist/2020.js";
import { parseDocument } from "yaml";

import {
  projectLoopLockSchema,
  projectLoopLockV2Schema,
  projectLoopManifestSchema,
  projectLoopManifestV2Schema,
  stageAgentsSchema,
  stageConfigurationSchema,
  stageSkillIndexSchema,
  type MaterializedEntry,
  type ProjectLoopLock,
  type ProjectLoopLockV2,
  type ProjectLoopManifest,
  type ProjectLoopManifestV2,
  type ProjectLoopStageContract,
} from "./contracts";
import { renderConfigurationGuide, resolveReachableStageMetadata } from "./configuration-guide";
import { resolveStageResources } from "./resource-resolver";

export type DoctorIssue = {
  code: string;
  message: string;
  nodeId: string;
  loopId?: string;
  subloopId?: string;
};

export type DoctorReport = {
  ready: boolean;
  errors: DoctorIssue[];
  warnings: DoctorIssue[];
  fingerprints: Record<string, `sha256:${string}`>;
};

function nodeError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

async function sha256(value: string): Promise<`sha256:${string}`> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function parseStrictYaml(content: string, code: string, label: string): unknown {
  const document = parseDocument(content, { uniqueKeys: true });
  if (document.errors.length > 0) throw nodeError(code, `${label} is not valid YAML`);
  return document.toJS({ maxAliasCount: 0 });
}

function validateOutputSchema(content: string, subloopId: string): Record<string, unknown> {
  try {
    const outputSchema: unknown = JSON.parse(content);
    if (!outputSchema || typeof outputSchema !== "object" || Array.isArray(outputSchema)) throw new Error("not an object");
    new Ajv2020({ allErrors: true, strict: true }).compile(outputSchema);
    return outputSchema as Record<string, unknown>;
  } catch {
    throw nodeError("invalid_output_schema", `Local output Schema is invalid: ${subloopId}`);
  }
}

type V2SubloopEntry = MaterializedEntry & { parentLoopId: string };

export async function readProjectLoopStageContract(input: {
  entry: V2SubloopEntry;
  readText(relativePath: string): Promise<string | null>;
}): Promise<ProjectLoopStageContract> {
  const entry = projectLoopLockV2Schema.parse({
    schemaVersion: 2,
    loops: {},
    subloops: { target: input.entry },
    migrations: {},
  }).subloops.target!;
  if (entry.state === "missing") throw nodeError("stage_file_missing", `Local Stage Package is missing: ${entry.stableId}`);
  if (entry.state === "orphaned") throw nodeError("stage_orphaned", `Local Stage is no longer present on the platform: ${entry.stableId}`);
  if (entry.state === "migration_required") throw nodeError("migration_required", `Local Stage requires explicit migration: ${entry.stableId}`);
  const paths = {
    stage: `${entry.path}/stage.yaml`,
    agents: `${entry.path}/agents.yaml`,
    skills: `${entry.path}/skills/index.yaml`,
    outputSchema: `${entry.path}/schemas/output-schema.json`,
  };
  const [stageText, agentsText, skillsText, outputSchemaText] = await Promise.all([
    input.readText(paths.stage),
    input.readText(paths.agents),
    input.readText(paths.skills),
    input.readText(paths.outputSchema),
  ]);
  if (stageText === null || agentsText === null || skillsText === null || outputSchemaText === null) {
    throw nodeError("stage_file_missing", `A required Stage Package file is missing: ${entry.stableId}`);
  }
  let stage;
  let agents;
  let skillSelection;
  try {
    stage = stageConfigurationSchema.parse(parseStrictYaml(stageText, "invalid_stage_config", "stage.yaml"));
  } catch (error) {
    if (error && typeof error === "object" && Reflect.get(error, "code") === "invalid_stage_config") throw error;
    throw nodeError("invalid_stage_config", `stage.yaml does not match Stage Package v2: ${entry.stableId}`);
  }
  try {
    agents = stageAgentsSchema.parse(parseStrictYaml(agentsText, "invalid_stage_agents", "agents.yaml"));
  } catch (error) {
    if (error && typeof error === "object" && Reflect.get(error, "code") === "invalid_stage_agents") throw error;
    throw nodeError("invalid_stage_agents", `agents.yaml is invalid: ${entry.stableId}`);
  }
  try {
    skillSelection = stageSkillIndexSchema.parse(parseStrictYaml(skillsText, "invalid_stage_skill_index", "skills/index.yaml"));
  } catch (error) {
    if (error && typeof error === "object" && Reflect.get(error, "code") === "invalid_stage_skill_index") throw error;
    throw nodeError("invalid_stage_skill_index", `skills/index.yaml is invalid: ${entry.stableId}`);
  }
  if (stage.loopId !== entry.parentLoopId || stage.subloopId !== entry.stableId) {
    throw nodeError("stage_identity_mismatch", `Stage identity does not match the lockfile: ${entry.stableId}`);
  }
  if (stage.inputScope.allowedCommands.some((command) => /[\u0000-\u001F\u007F]/u.test(command))) {
    throw nodeError("invalid_stage_config", `Stage allowed command contains control characters: ${entry.stableId}`);
  }
  const outputSchema = validateOutputSchema(outputSchemaText, entry.stableId);
  const fingerprint = await sha256(JSON.stringify({ stage, agents, skillSelection, outputSchema }));
  return {
    loopId: stage.loopId,
    subloopId: stage.subloopId,
    stagePath: entry.path,
    configured: stage.configured,
    businessGoal: stage.businessGoal,
    inputScope: stage.inputScope,
    resourceScope: stage.resourceScope,
    checklist: stage.checklist,
    qualityGate: stage.qualityGate,
    ...(stage.autoRecovery ? { autoRecovery: stage.autoRecovery } : {}),
    agents,
    skillSelection,
    outputSchema,
    fingerprint,
  };
}

type V1ReadinessInput = {
  manifest: ProjectLoopManifest;
  lock: ProjectLoopLock;
  readText(relativePath: string): Promise<string | null>;
};

type V2ReadinessInput = {
  manifest: ProjectLoopManifestV2;
  lock: ProjectLoopLockV2;
  readText(relativePath: string): Promise<string | null>;
  listTree(relativePath: string): Promise<string[]>;
  expectedCatalogVersion?: string;
};

async function validateV1ProjectLoopReadiness(input: V1ReadinessInput): Promise<DoctorReport> {
  projectLoopManifestSchema.parse(input.manifest);
  const lock = projectLoopLockSchema.parse(input.lock);
  const entries = Object.values(lock.nodes);
  return {
    ready: false,
    errors: (entries.length > 0 ? entries : [{ stableId: "", parentLoopId: undefined }]).map((entry) => ({
      code: "migration_required",
      message: "Local Loop contract v1 is not executable; run ht migrate before continuing",
      nodeId: entry.stableId,
      ...(entry.parentLoopId ? { loopId: entry.parentLoopId } : {}),
    })),
    warnings: [],
    fingerprints: {},
  };
}

const STAGE_DIRECTORIES = ["prompts", "resources", "rules", "schemas", "skills", "templates"] as const;

function stageIssue(error: unknown, entry: V2SubloopEntry, fallbackCode = "invalid_stage_config"): DoctorIssue {
  return {
    code: error && typeof error === "object" ? String(Reflect.get(error, "code") ?? fallbackCode) : fallbackCode,
    message: error instanceof Error ? error.message : `Local Stage validation failed: ${entry.stableId}`,
    nodeId: entry.stableId,
    subloopId: entry.stableId,
    loopId: entry.parentLoopId,
  };
}

async function validateV2ProjectLoopReadiness(input: V2ReadinessInput): Promise<DoctorReport> {
  const manifest = projectLoopManifestV2Schema.parse(input.manifest);
  const lock = projectLoopLockV2Schema.parse(input.lock);
  const reachable = resolveReachableStageMetadata(manifest);
  const reachableIds = new Set(reachable.stages.map(({ storageId }) => storageId));
  const errors: DoctorIssue[] = reachable.issues.map((issue) => ({
    code: issue.code,
    message: issue.message,
    nodeId: issue.nodeId ?? issue.subloopId ?? "",
    ...(issue.nodeId ? { subloopId: issue.nodeId } : {}),
    ...(issue.loopId ? { loopId: issue.loopId } : {}),
  }));
  const warnings: DoctorIssue[] = [];
  const fingerprints: Record<string, `sha256:${string}`> = {};

  if (input.expectedCatalogVersion !== undefined && input.expectedCatalogVersion !== manifest.catalogVersion) {
    errors.push({ code: "catalog_digest_mismatch", message: "Local Catalog digest does not match the current platform projection", nodeId: "" });
  }
  const expectedGuide = renderConfigurationGuide({ manifest, lock });
  const currentGuide = await input.readText(".humanthread/CONFIGURATION.md");
  if (currentGuide !== expectedGuide) {
    errors.push({ code: "configuration_guide_outdated", message: "Run ht init to refresh .humanthread/CONFIGURATION.md", nodeId: "" });
  }

  for (const stage of reachable.stages) {
    if (lock.subloops[stage.storageId]) continue;
    errors.push({
      code: "stage_file_missing",
      message: `Reachable Stage is absent from the local lockfile: ${stage.subloopId}`,
      nodeId: stage.subloopId,
      subloopId: stage.subloopId,
      loopId: stage.loopId,
    });
  }

  for (const [storageId, entry] of Object.entries(lock.subloops).sort(([left], [right]) => left.localeCompare(right))) {
    const isReachable = reachableIds.has(storageId);
    if (entry.state === "orphaned") {
      warnings.push({
        code: "stage_orphaned",
        message: `Local Stage is no longer present on the platform: ${entry.stableId}`,
        nodeId: entry.stableId,
        subloopId: entry.stableId,
        loopId: entry.parentLoopId,
      });
      continue;
    }
    try {
      const contract = await readProjectLoopStageContract({ entry, readText: input.readText });
      for (const directory of STAGE_DIRECTORIES) {
        if ((await input.listTree(`${entry.path}/${directory}`)).length === 0) {
          throw nodeError("stage_directory_missing", `Required Stage directory is missing or empty: ${entry.path}/${directory}`);
        }
      }
      const resources = [];
      for (const exec of contract.agents.execRuns) {
        resources.push(await resolveStageResources({
          stage: contract,
          execId: exec.execId,
          readText: input.readText,
          listTree: input.listTree,
        }));
      }
      if (!contract.configured) throw nodeError("stage_unconfigured", `Local Stage is not configured: ${entry.stableId}`);
      if (!contract.businessGoal.trim()) throw nodeError("stage_business_goal_missing", `Configured Stage has no business goal: ${entry.stableId}`);
      fingerprints[storageId] = await sha256(JSON.stringify({
        contract: contract.fingerprint,
        resources: resources.map(({ fingerprint }) => fingerprint),
      }));
    } catch (error) {
      const issue = stageIssue(error, entry);
      if (isReachable) errors.push(issue);
      else warnings.push(issue);
    }
  }
  return { ready: errors.length === 0, errors, warnings, fingerprints };
}

export function validateProjectLoopReadiness(input: V1ReadinessInput): Promise<DoctorReport>;
export function validateProjectLoopReadiness(input: V2ReadinessInput): Promise<DoctorReport>;
export function validateProjectLoopReadiness(input: V1ReadinessInput | V2ReadinessInput): Promise<DoctorReport> {
  return input.lock.schemaVersion === 2
    ? validateV2ProjectLoopReadiness(input as V2ReadinessInput)
    : validateV1ProjectLoopReadiness(input as V1ReadinessInput);
}
