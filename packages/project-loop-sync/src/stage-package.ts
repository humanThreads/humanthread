import { stringify } from "yaml";
import { z } from "zod";

import {
  stageAgentsSchema,
  stageConfigurationSchema,
  stageSkillIndexSchema,
} from "./contracts";

const stagePackagePathSchema = z.string().min(1).max(1_024).refine((value) => (
  !value.startsWith("/")
  && !value.includes("\\")
  && !/^[a-z]:/iu.test(value)
  && value.split("/").every((part) => part !== "" && part !== "." && part !== "..")
), "Stage Package path must be project-relative");
const stageIdentitySchema = z.string().trim().min(1).max(128);

const RESOURCE_DIRECTORIES = [
  "prompts",
  "resources",
  "rules",
  "schemas",
  "skills",
  "templates",
] as const;

export function createStagePackageFileGroup(input: {
  loopId: string;
  subloopId: string;
  path: string;
  label: string;
}): { directories: string[]; files: Array<{ path: string; content: string }> } {
  const path = stagePackagePathSchema.parse(input.path);
  const loopId = stageIdentitySchema.parse(input.loopId);
  const subloopId = stageIdentitySchema.parse(input.subloopId);
  const label = z.string().trim().min(1).max(191).parse(input.label);
  const stage = stageConfigurationSchema.parse({
    schemaVersion: 2,
    loopId,
    subloopId,
    configured: false,
    businessGoal: "",
    inputScope: {
      codeAccess: true,
      writeAccess: true,
      include: [],
      exclude: [],
      allowedCommands: [],
      blockedPaths: [],
    },
    resourceScope: {
      prompts: true,
      resources: true,
      rules: true,
      schemas: true,
      skills: true,
      templates: true,
    },
    checklist: [],
    qualityGate: {
      checks: [],
      requiredArtifacts: [],
      minConfidence: 0.8,
    },
  });
  const agents = stageAgentsSchema.parse({
    schemaVersion: 1,
    executionMode: "SINGLE_WRITER",
    execRuns: [{ execId: "main", role: "primary", resumePolicy: "CHECKPOINT" }],
  });
  const skills = stageSkillIndexSchema.parse({ schemaVersion: 1, mode: "none" });

  return {
    directories: RESOURCE_DIRECTORIES.map((directory) => `${path}/${directory}`),
    files: [
      { path: `${path}/stage.yaml`, content: stringify(stage) },
      { path: `${path}/agents.yaml`, content: stringify(agents) },
      {
        path: `${path}/prompts/main.md`,
        content: `# ${label}\n\nDescribe the execution steps and required evidence for this stage.\n`,
      },
      { path: `${path}/resources/.gitkeep`, content: "" },
      { path: `${path}/rules/.gitkeep`, content: "" },
      { path: `${path}/schemas/output-schema.json`, content: `${JSON.stringify(execResultSchema(), null, 2)}\n` },
      { path: `${path}/skills/index.yaml`, content: stringify(skills) },
      { path: `${path}/templates/.gitkeep`, content: "" },
    ],
  };
}

function execResultSchema(): Record<string, unknown> {
  const artifactReference = {
    type: "string",
    minLength: 1,
    maxLength: 1_024,
    pattern: "^(?!/)(?![A-Za-z]:)(?!.*(?:^|/)\\.\\.(?:/|$))(?!.*\\\\).+$",
  };
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    required: ["execId", "status", "issueType", "summary", "confidence", "evidence", "artifacts", "checkpoint"],
    properties: {
      execId: { type: "string", minLength: 1, maxLength: 96, pattern: "^[A-Za-z0-9_-]+$" },
      status: {
        enum: ["SUCCESS", "FAILED", "NEEDS_CLARIFICATION", "TIMEOUT", "OUTPUT_PARSE_FAILED"],
      },
      issueType: { type: "string", minLength: 1, maxLength: 96, pattern: "^[A-Z][A-Z0-9_]*$" },
      summary: { type: "string", minLength: 1, maxLength: 4_000 },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      evidence: { type: "array", maxItems: 100, uniqueItems: true, items: artifactReference },
      artifacts: { type: "array", maxItems: 100, uniqueItems: true, items: artifactReference },
      checkpoint: {
        anyOf: [
          { type: "null" },
          {
            type: "object",
            additionalProperties: false,
            required: ["branch", "commit"],
            properties: {
              branch: { type: "string", minLength: 1, maxLength: 191 },
              commit: { type: "string", pattern: "^[a-f0-9]{40}(?:[a-f0-9]{24})?$" },
            },
          },
        ],
      },
    },
  };
}
