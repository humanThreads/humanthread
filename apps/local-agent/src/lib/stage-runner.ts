import type { LoopAssignment } from "@humanthread/shared";
import type { ProjectLoopStageContract, ResolvedStageResources } from "@humanthread/project-loop-sync";

import { renderProjectConstraints, type ConstraintBundle } from "./project-constraints";

export type StageExecution = {
  execId: string;
  prompt: string;
  outputSchema: Record<string, unknown>;
  contextFingerprint: `sha256:${string}`;
  globalConstraintFingerprint: `sha256:${string}` | null;
  context: {
    rules: string[];
    resources: string[];
    schemas: string[];
    templates: string[];
    skills: string[];
  };
};

async function sha256(value: string): Promise<`sha256:${string}`> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function checkpointIdentity(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const identity: Record<string, string> = {};
  for (const key of ["branch", "commit"] as const) {
    const candidate = Reflect.get(value, key);
    if (typeof candidate === "string" && candidate.trim()) identity[key] = candidate.slice(0, 256);
  }
  return Object.keys(identity).length > 0 ? identity : null;
}

const TASK_EXECUTION_CONTEXT_KEYS = [
  "taskId",
  "projectId",
  "taskNumber",
  "shortId",
  "taskBranch",
  "taskCreatedAt",
  "productionBranch",
  "stagingBranch",
] as const;

function taskExecutionContext(value: unknown): Record<string, string | number | null> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const context: Record<string, string | number | null> = {};
  for (const key of TASK_EXECUTION_CONTEXT_KEYS) {
    const candidate = Reflect.get(value, key);
    if (candidate === null) context[key] = null;
    else if (typeof candidate === "string" && candidate.trim()) context[key] = candidate.slice(0, 512);
    else if (typeof candidate === "number" && Number.isFinite(candidate)) context[key] = candidate;
  }
  return Object.keys(context).length > 0 ? context : null;
}

type ScheduledTaskPromptContext = {
  id: string;
  name: string;
  description: string;
  contentMarkdown?: string;
};

const sensitiveScheduledTaskValue = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+\/-]+=*\b|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}\b|\b(?:mysql|postgres(?:ql)?|mongodb(?:\+srv)?):\/\/[^\s]+|\bhttps?:\/\/[^\s:@]+:[^\s@]+@[^\s]+/giu;
const sensitiveScheduledTaskAssignment = /((?:access[_-]?key|api[_-]?key|authorization|client[_-]?secret|credential|password|secret|token)\s*[=:]\s*)[^\s,;]+/giu;

function boundedScheduledTaskText(value: string, maxLength: number): string {
  const redacted = value
    .replace(sensitiveScheduledTaskValue, "[REDACTED]")
    .replace(sensitiveScheduledTaskAssignment, "$1[redacted]")
    .trim();
  return redacted.length <= maxLength
    ? redacted
    : `${redacted.slice(0, maxLength)}\n\n[Scheduled task content truncated by HumanThread]`;
}

function scheduledTaskPromptContext(value: unknown): ScheduledTaskPromptContext | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw invalidScheduledTaskContext();
  const contentMode = Reflect.get(value, "contentMode");
  if (contentMode !== "platform" && contentMode !== "loop_managed") throw invalidScheduledTaskContext();
  const id = Reflect.get(value, "id");
  if (typeof id !== "string" || !id.trim()) throw invalidScheduledTaskContext();
  const name = Reflect.get(value, "name");
  const description = Reflect.get(value, "description");
  const context = {
    id: boundedScheduledTaskText(id, 128),
    name: boundedScheduledTaskText(typeof name === "string" ? name : "Scheduled task", 512),
    description: boundedScheduledTaskText(typeof description === "string" ? description : "", 4_000),
  };
  if (contentMode === "loop_managed") return context;
  const contentMarkdown = Reflect.get(value, "contentMarkdown");
  if (typeof contentMarkdown !== "string" || !contentMarkdown.trim()) throw invalidScheduledTaskContext();
  return { ...context, contentMarkdown: boundedScheduledTaskText(contentMarkdown, 12_000) };
}

function renderScheduledTaskPromptContext(value: ScheduledTaskPromptContext): string {
  return [
    "Scheduled task execution context:",
    `Scheduled task id: ${value.id}`,
    `Scheduled task name: ${value.name}`,
    `Scheduled task description: ${value.description}`,
    ...(value.contentMarkdown ? ["", "Scheduled task content:", value.contentMarkdown] : []),
  ].join("\n");
}

function invalidScheduledTaskContext(): Error & { code: "stage_scheduled_task_invalid" } {
  return Object.assign(new Error("Scheduled task execution context is invalid"), {
    code: "stage_scheduled_task_invalid" as const,
  });
}

function renderEntries(title: string, entries: Array<{ path: string; content: string }>): string {
  if (entries.length === 0) return "";
  return [`## ${title}`, ...entries.flatMap(({ path, content }) => [`### ${path}`, content])].join("\n\n");
}

export async function buildStageExecution(input: {
  stage: ProjectLoopStageContract;
  resources: ResolvedStageResources;
  assignment: LoopAssignment;
  provider: "codex" | "claude";
  constraints?: ConstraintBundle | null;
  execId?: string;
}): Promise<StageExecution> {
  const exec = input.execId
    ? input.stage.agents.execRuns.find(({ execId }) => execId === input.execId)
    : input.stage.agents.execRuns[0];
  if (!exec) throw Object.assign(new Error("Stage execution is not declared in agents.yaml"), { code: "stage_exec_not_found" });
  const context = {
    rules: input.resources.rules.map(({ path }) => path),
    resources: input.resources.resources.map(({ path }) => path),
    schemas: input.resources.schemas.map(({ path }) => path),
    templates: input.resources.templates.map(({ path }) => path),
    skills: input.resources.skills.map(({ path }) => path),
  };
  const constraintText = input.constraints ? renderProjectConstraints(input.constraints) : "";
  const taskContext = taskExecutionContext(input.assignment.inputSnapshot);
  const scheduledTaskContext = scheduledTaskPromptContext(
    input.assignment.inputSnapshot && typeof input.assignment.inputSnapshot === "object" && !Array.isArray(input.assignment.inputSnapshot)
      ? Reflect.get(input.assignment.inputSnapshot, "scheduledTask")
      : null,
  );
  const scheduledTaskText = scheduledTaskContext ? renderScheduledTaskPromptContext(scheduledTaskContext) : "";
  const scope = [
    `Code access: ${String(input.stage.inputScope.codeAccess)}`,
    `Write access: ${String(input.stage.inputScope.writeAccess)}`,
    `Included paths: ${input.stage.inputScope.include.join(", ") || "none"}`,
    `Excluded paths: ${input.stage.inputScope.exclude.join(", ") || "none"}`,
    `Allowed commands: ${input.stage.inputScope.allowedCommands.join(", ") || "none"}`,
    `Blocked paths: ${input.stage.inputScope.blockedPaths.join(", ") || "none"}`,
  ].join("\n");
  const runIdentity = JSON.stringify({
    assignmentId: input.assignment.id,
    loopRunId: input.assignment.loopRunId,
    loopNodeRunId: input.assignment.loopNodeRunId,
    loopNodeAttemptId: input.assignment.loopNodeAttemptId,
    stage: `${input.stage.loopId}/${input.stage.subloopId}`,
    execId: exec.execId,
    checkpoint: checkpointIdentity(input.assignment.checkpointSnapshot),
  });
  const sections = [
    constraintText,
    `# Stage ${input.stage.loopId}/${input.stage.subloopId}\n\nBusiness goal: ${input.stage.businessGoal}\n\nRun identity: ${runIdentity}\n\nTask execution context: ${JSON.stringify(taskContext ?? {})}\n\n## Input scope\n${scope}`,
    scheduledTaskText,
    input.resources.prompt,
    renderEntries("Rules", input.resources.rules),
    renderEntries("Resources", input.resources.resources),
    renderEntries("Schemas", input.resources.schemas),
    renderEntries("Templates", input.resources.templates),
    renderEntries("Selected Skills", input.resources.skills.map(({ path, content }) => ({ path, content }))),
  ].filter(Boolean);
  const prompt = sections.join("\n\n");
  const contextFingerprint = await sha256(JSON.stringify({
    stageFingerprint: input.stage.fingerprint,
    resourceFingerprint: input.resources.fingerprint,
    globalConstraintFingerprint: input.constraints?.fingerprint ?? null,
    runIdentity,
    execId: exec.execId,
    prompt,
    context,
  }));
  return {
    execId: exec.execId,
    prompt,
    outputSchema: input.stage.outputSchema,
    contextFingerprint,
    globalConstraintFingerprint: input.constraints?.fingerprint ?? null,
    context,
  };
}
