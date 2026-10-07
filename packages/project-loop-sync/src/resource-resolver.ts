import {
  stageSkillIndexSchema,
  type ProjectLoopStageContract,
} from "./contracts";

const TEXT_RESOURCE = /\.(?:md|txt|ya?ml|json)$/iu;
const MAX_FILE_CHARACTERS = 24_000;
const MAX_CONTEXT_BYTES = 128 * 1024;
const SKILL_PATH = /^\.agents\/skills\/([a-z0-9]+(?:-[a-z0-9]+)*)\/SKILL\.md$/u;

export type ResolvedStageResources = {
  prompt: string;
  rules: Array<{ path: string; content: string }>;
  resources: Array<{ path: string; content: string }>;
  schemas: Array<{ path: string; content: string }>;
  templates: Array<{ path: string; content: string }>;
  skills: Array<{ key: string; path: string; content: string }>;
  fingerprint: `sha256:${string}`;
};

function resourceError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function truncateCharacters(value: string, limit: number): string {
  return Array.from(value).slice(0, limit).join("");
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength <= maxBytes) return value;
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, maxBytes)).replace(/\uFFFD$/u, "");
}

async function sha256(value: string): Promise<`sha256:${string}`> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function readRequired(input: {
  path: string;
  readText(path: string): Promise<string | null>;
  code: string;
}): Promise<string> {
  const content = await input.readText(input.path);
  if (content === null) throw resourceError(input.code, `Required Stage resource is missing: ${input.path}`);
  return content;
}

async function selectedSkills(input: {
  stage: ProjectLoopStageContract;
  readText(path: string): Promise<string | null>;
  listTree(path: string): Promise<string[]>;
}): Promise<Array<{ key: string; path: string; content: string }>> {
  const parsed = stageSkillIndexSchema.safeParse(input.stage.skillSelection);
  if (!parsed.success) throw resourceError("invalid_stage_skill_index", "Stage Skill index is invalid");
  if (!input.stage.resourceScope.skills || parsed.data.mode === "none") return [];

  let keys: string[];
  if (parsed.data.mode === "include") {
    keys = [...parsed.data.skills];
  } else {
    const skillPaths = (await input.listTree(".agents/skills")).filter((path) => path.endsWith("/SKILL.md"));
    const matches = skillPaths.map((path) => SKILL_PATH.exec(path));
    if (matches.some((match) => match === null)) {
      throw resourceError("invalid_stage_skill_index", "A discovered Skill path is invalid");
    }
    keys = matches.map((match) => match![1]!);
    if (new Set(keys).size !== keys.length) {
      throw resourceError("invalid_stage_skill_index", "Discovered Skill keys must be unique");
    }
  }
  keys = [...new Set(keys)].sort();
  const skills = [];
  for (const key of keys) {
    const path = `.agents/skills/${key}/SKILL.md`;
    if (!SKILL_PATH.test(path)) throw resourceError("invalid_stage_skill_index", `Stage Skill key is unsafe: ${key}`);
    const content = await input.readText(path);
    if (content === null) throw resourceError("stage_skill_missing", `Selected Stage Skill is missing: ${key}`);
    skills.push({ key, path, content });
  }
  return skills;
}

async function visibleResources(input: {
  stage: ProjectLoopStageContract;
  kind: "rules" | "resources" | "schemas" | "templates";
  readText(path: string): Promise<string | null>;
  listTree(path: string): Promise<string[]>;
  budget: { remaining: number };
}): Promise<Array<{ path: string; content: string }>> {
  if (!input.stage.resourceScope[input.kind]) return [];
  const root = `${input.stage.stagePath}/${input.kind}`;
  const paths = (await input.listTree(root)).filter((path) => TEXT_RESOURCE.test(path)).sort();
  const resources = [];
  for (const path of paths) {
    const raw = await readRequired({ path, readText: input.readText, code: "stage_resource_missing" });
    const bounded = truncateCharacters(raw, MAX_FILE_CHARACTERS);
    const content = truncateUtf8(bounded, input.budget.remaining);
    input.budget.remaining -= utf8Bytes(content);
    resources.push({ path, content });
  }
  return resources;
}

export async function resolveStageResources(input: {
  stage: ProjectLoopStageContract;
  execId: string;
  readText(path: string): Promise<string | null>;
  listTree(path: string): Promise<string[]>;
}): Promise<ResolvedStageResources> {
  if (!/^[A-Za-z0-9_-]{1,96}$/u.test(input.execId)) {
    throw resourceError("invalid_stage_exec_id", "Stage exec ID is invalid");
  }
  if (!input.stage.resourceScope.prompts) throw resourceError("stage_prompt_disabled", "Stage prompt resources are disabled");
  const execPrompt = `${input.stage.stagePath}/prompts/${input.execId}.md`;
  const mainPrompt = `${input.stage.stagePath}/prompts/main.md`;
  const prompt = await input.readText(execPrompt) ?? await readRequired({
    path: mainPrompt,
    readText: input.readText,
    code: "stage_prompt_missing",
  });

  const skills = await selectedSkills(input);
  const reservedBytes = utf8Bytes(prompt) + skills.reduce((total, skill) => total + utf8Bytes(skill.content), 0);
  if (reservedBytes > MAX_CONTEXT_BYTES) {
    throw resourceError("stage_resource_context_too_large", "Stage prompt and selected Skills exceed the 128 KiB context limit");
  }
  const budget = { remaining: MAX_CONTEXT_BYTES - reservedBytes };
  const rules = await visibleResources({ ...input, kind: "rules", budget });
  const resources = await visibleResources({ ...input, kind: "resources", budget });
  const schemas = await visibleResources({ ...input, kind: "schemas", budget });
  const templates = await visibleResources({ ...input, kind: "templates", budget });
  const fingerprint = await sha256(JSON.stringify({ prompt, rules, resources, schemas, templates, skills }));
  return { prompt, rules, resources, schemas, templates, skills, fingerprint };
}
