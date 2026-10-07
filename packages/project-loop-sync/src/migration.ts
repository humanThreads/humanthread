import { parse, stringify } from "yaml";
import { z } from "zod";

const V1_FILES = ["node.yaml", "rules.md", "prompt.md", "schemas/output.schema.json"] as const;
const migrationPath = z.string().min(1).max(1_024).refine((value) => (
  !value.startsWith("/")
  && !value.includes("\\")
  && !/^[a-z]:/iu.test(value)
  && value.split("/").every((part) => part !== "" && part !== "." && part !== "..")
), "Migration path must be project-relative");

export const explicitV1MigrationReportSchema = z.object({
  schemaVersion: z.literal(1),
  stageId: z.string().trim().min(3).max(257),
  loopId: z.string().trim().min(1).max(128),
  subloopId: z.string().trim().min(1).max(128),
  sourcePath: migrationPath,
  backupPath: migrationPath,
  stagePath: migrationPath,
  status: z.literal("prepared"),
  createdAt: z.iso.datetime({ offset: true }),
}).strict();

export type ExplicitV1MigrationReport = z.infer<typeof explicitV1MigrationReportSchema>;

function readableSegment(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9_-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return (normalized || "stage").slice(0, 32);
}

function identityHash(value: string): string {
  let hash = 14_695_981_039_346_656_037n;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 1_099_511_628_211n);
  }
  return hash.toString(16).padStart(16, "0");
}

function identitySegment(value: string): string {
  return `${readableSegment(value)}-${identityHash(value)}`;
}

export function explicitV1MigrationReportPath(loopId: string, subloopId: string): string {
  return `.humanthread/migrations/${identitySegment(loopId)}--${identitySegment(subloopId)}.json`;
}

export function explicitV1MigrationStageSegment(subloopId: string): string {
  return identitySegment(subloopId);
}

export function explicitV1MigrationTransactionId(loopId: string, subloopId: string): string {
  return `explicit-v1-v2-${identityHash(loopId)}-${identityHash(subloopId)}`;
}

export function readPreparedExplicitV1Migration(input: {
  loopId: string;
  subloopId: string;
  inventory: { contents?: Record<string, string> };
}): ExplicitV1MigrationReport | null {
  const content = input.inventory.contents?.[explicitV1MigrationReportPath(input.loopId, input.subloopId)];
  if (content === undefined) return null;
  try {
    const report = explicitV1MigrationReportSchema.parse(JSON.parse(content));
    return report.loopId === input.loopId
      && report.subloopId === input.subloopId
      && report.stageId === `${input.loopId}/${input.subloopId}`
      ? report
      : null;
  } catch {
    return null;
  }
}

function blocked(reason: string) {
  return {
    kind: "blocked" as const,
    code: "migration_required" as const,
    reason,
    writes: [] as never[],
  };
}

function v1OutputSchema(): string {
  return `${JSON.stringify({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {},
  }, null, 2)}\n`;
}

function expectedNodeYaml(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const loopId = Reflect.get(value, "loopId");
  const nodeId = Reflect.get(value, "nodeId");
  if (typeof loopId !== "string" || typeof nodeId !== "string") return null;
  return stringify({
    schemaVersion: 1,
    loopId,
    nodeId,
    configured: false,
    instructions: "rules.md",
    prompt: "prompt.md",
    skillsDirectory: "skills",
    outputSchema: "schemas/output.schema.json",
    checks: [],
  });
}

export type V1MigrationDetection =
  | { kind: "automatic" }
  | { kind: "blocked"; code: "migration_required"; reason: string; writes: never[] };

export function detectV1Migration(input: { files: Record<string, string> }): V1MigrationDetection {
  const paths = Object.keys(input.files).sort();
  if (paths.length !== V1_FILES.length || V1_FILES.some((path) => !Object.hasOwn(input.files, path))) {
    return blocked("The v1 stage contains missing or additional project files");
  }

  const nodeYaml = input.files["node.yaml"]!;
  let node: unknown;
  try {
    node = parse(nodeYaml);
  } catch {
    return blocked("node.yaml is not the built-in v1 template");
  }
  if (expectedNodeYaml(node) !== nodeYaml) return blocked("node.yaml was modified after initialization");

  const rules = input.files["rules.md"]!;
  const match = /^# (.+) Rules\n\nConfigure this node for the current project\.\n$/u.exec(rules);
  if (!match) return blocked("rules.md was modified after initialization");
  const label = match[1]!;
  if (input.files["prompt.md"] !== `Execute the ${label} node for this project.\n`) {
    return blocked("prompt.md was modified after initialization");
  }
  if (input.files["schemas/output.schema.json"] !== v1OutputSchema()) {
    return blocked("The v1 output Schema was modified after initialization");
  }
  return { kind: "automatic" };
}
