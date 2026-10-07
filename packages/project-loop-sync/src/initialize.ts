import {
  projectLoopCatalogV2Schema,
  projectLoopLockSchema,
  projectLoopLockV2Schema,
  projectLoopManifestSchema,
  projectLoopManifestV2Schema,
  type LocalFileInventory,
  type ProjectLoopCatalogV2,
  type ProjectLoopLock,
  type ProjectLoopLockV2,
  type ProjectLoopManifest,
  type ProjectLoopManifestV2,
  type ProjectLoopSyncFilesystem,
} from "./contracts";
import { applyLoopSyncPlanV2 } from "./apply-plan";
import { renderConfigurationGuide } from "./configuration-guide";
import { planProjectLoopSyncV2 } from "./reconcile";

const CONFIGURATION_GUIDE_PATH = ".humanthread/CONFIGURATION.md";
const MANIFEST_PATH = ".humanthread/structure/manifest.json";
const LOCK_PATH = ".humanthread/structure/lock.json";
const CLAUDE_PATH = "CLAUDE.md";
const PROJECT_MANIFEST_PATH = "humanthread.yaml";
const MANAGED_BLOCK_START = "<!-- HUMANTHREAD:SKILLS:START -->";
const MANAGED_BLOCK_END = "<!-- HUMANTHREAD:SKILLS:END -->";
const DEFAULT_PROJECT_MANIFEST = [
  "schemaVersion: 1",
  "constraints:",
  "  sources: []",
  "  hierarchical:",
  "    enabled: true",
  "    filename: AGENTS.md",
  "  checks: []",
  "",
].join("\n");
const CLAUDE_SKILL_DISCOVERY_BLOCK = [
  MANAGED_BLOCK_START,
  "## HumanThread Skills",
  "",
  "When a HumanThread Stage selects a Skill, load its complete `.agents/skills/<skill-key>/SKILL.md` file.",
  "Treat `.agents/skills/` as the only project Skill source; do not copy Skill content into `.humanthread/`.",
  MANAGED_BLOCK_END,
  "",
].join("\n");

export type ProjectLoopInitializationState = {
  manifest: ProjectLoopManifest | ProjectLoopManifestV2 | null;
  lock: ProjectLoopLock | ProjectLoopLockV2 | null;
  inventory: LocalFileInventory;
  claudeInstructions: string | null;
  projectManifest: string | null;
};

function initializationError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function parseVersionedJson<T>(content: string | null, label: string, parse: (value: unknown) => T): T | null {
  if (content === null) return null;
  try {
    return parse(JSON.parse(content));
  } catch {
    throw initializationError("local_structure_invalid", `${label} is invalid`);
  }
}

function parseManifest(value: unknown): ProjectLoopManifest | ProjectLoopManifestV2 {
  if (value && typeof value === "object" && Reflect.get(value, "schemaVersion") === 2) {
    return projectLoopManifestV2Schema.parse(value);
  }
  return projectLoopManifestSchema.parse(value);
}

function parseLock(value: unknown): ProjectLoopLock | ProjectLoopLockV2 {
  if (value && typeof value === "object" && Reflect.get(value, "schemaVersion") === 2) {
    return projectLoopLockV2Schema.parse(value);
  }
  return projectLoopLockSchema.parse(value);
}

export function renderClaudeSkillDiscovery(current: string | null): string {
  const content = current ?? "";
  const start = content.indexOf(MANAGED_BLOCK_START);
  const secondStart = start < 0 ? -1 : content.indexOf(MANAGED_BLOCK_START, start + MANAGED_BLOCK_START.length);
  const end = start < 0 ? -1 : content.indexOf(MANAGED_BLOCK_END, start + MANAGED_BLOCK_START.length);
  const secondEnd = end < 0 ? -1 : content.indexOf(MANAGED_BLOCK_END, end + MANAGED_BLOCK_END.length);
  if (start < 0 && end < 0) return `${content}${CLAUDE_SKILL_DISCOVERY_BLOCK}`;
  if (start < 0 || end < 0 || secondStart >= 0 || secondEnd >= 0 || end < start) {
    throw initializationError("claude_managed_block_invalid", "CLAUDE.md contains an invalid HumanThread managed block");
  }
  let suffixStart = end + MANAGED_BLOCK_END.length;
  if (content.startsWith("\r\n", suffixStart)) suffixStart += 2;
  else if (content.startsWith("\n", suffixStart)) suffixStart += 1;
  return `${content.slice(0, start)}${CLAUDE_SKILL_DISCOVERY_BLOCK}${content.slice(suffixStart)}`;
}

export async function readProjectLoopInitializationState(
  fs: ProjectLoopSyncFilesystem,
): Promise<ProjectLoopInitializationState> {
  const [manifestText, lockText, inventoryPaths, claudeInstructions, projectManifest] = await Promise.all([
    fs.readText(MANIFEST_PATH),
    fs.readText(LOCK_PATH),
    fs.listTree(".humanthread"),
    fs.readText(CLAUDE_PATH),
    fs.readText(PROJECT_MANIFEST_PATH),
  ]);
  const manifest = parseVersionedJson(manifestText, "Loop manifest", parseManifest);
  const lock = parseVersionedJson(lockText, "Loop lockfile", parseLock);
  const legacyPaths = lock?.schemaVersion === 1 ? Object.values(lock.nodes).map(({ path }) => path) : [];
  const migrationContentPaths = inventoryPaths.filter((path) => (
    legacyPaths.some((prefix) => path.startsWith(`${prefix}/`))
    || /^\.humanthread\/runtime\/sync\/[^/]+\/backup\/loops\/.+\/nodes\/.+/u.test(path)
    || /^\.humanthread\/migrations\/[^/]+\.json$/u.test(path)
  ));
  const contents = Object.fromEntries(await Promise.all(migrationContentPaths.map(async (path) => {
    const content = await fs.readText(path);
    return [path, content] as const;
  })));
  return {
    manifest,
    lock,
    inventory: {
      files: inventoryPaths,
      contents: Object.fromEntries(Object.entries(contents).filter((entry): entry is [string, string] => entry[1] !== null)),
    },
    claudeInstructions,
    projectManifest,
  };
}

export async function initializeProjectLoops(input: {
  fs: ProjectLoopSyncFilesystem;
  catalog: ProjectLoopCatalogV2;
  previousState: ProjectLoopInitializationState;
  now: Date;
}) {
  const catalog = projectLoopCatalogV2Schema.parse(input.catalog);
  if (input.previousState.manifest && input.previousState.manifest.projectId !== catalog.projectId) {
    throw initializationError("project_identity_mismatch", "Local Loop configuration belongs to another Project");
  }
  const plan = planProjectLoopSyncV2({
    catalog,
    previousManifest: input.previousState.manifest,
    previousLock: input.previousState.lock,
    inventory: input.previousState.inventory,
    synchronizedAt: input.now.toISOString(),
  });
  if (plan.kind === "blocked") {
    const error = initializationError("migration_required", "Local v1 rules require explicit migration before ht init can continue");
    Object.assign(error, { diagnostics: plan.diagnostics, blockingIssues: plan.blockingIssues });
    throw error;
  }
  const guide = renderConfigurationGuide({ manifest: plan.manifest, lock: plan.lock });
  const claudeInstructions = renderClaudeSkillDiscovery(input.previousState.claudeInstructions);
  const applied = await applyLoopSyncPlanV2({
    fs: input.fs,
    plan: {
      ...plan,
      generatedWrites: [
        ...plan.generatedWrites,
        { path: CONFIGURATION_GUIDE_PATH, content: guide },
        { path: CLAUDE_PATH, content: claudeInstructions },
      ],
    },
  });
  if (input.previousState.projectManifest === null) {
    await input.fs.writeTextExclusive(PROJECT_MANIFEST_PATH, DEFAULT_PROJECT_MANIFEST);
  }
  return {
    synchronized: true as const,
    projectId: catalog.projectId,
    catalogVersion: catalog.catalogVersion,
    ...applied,
    configurationGuide: CONFIGURATION_GUIDE_PATH,
    diagnostics: plan.diagnostics,
    warnings: plan.diagnostics,
    blockingIssues: plan.blockingIssues,
  };
}
