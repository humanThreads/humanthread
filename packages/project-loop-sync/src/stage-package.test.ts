import Ajv2020 from "ajv/dist/2020.js";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

import {
  projectLoopCatalogSchema,
  projectLoopCatalogV2Schema,
  stageAgentsSchema,
  stageConfigurationSchema,
  stageSkillIndexSchema,
} from "./contracts";
import { createStagePackageFileGroup } from "./stage-package";

describe("createStagePackageFileGroup", () => {
  it("creates every required resource directory and one authoritative output Schema", () => {
    const group = createStagePackageFileGroup({
      loopId: "loop_project",
      subloopId: "develop",
      path: ".humanthread/loops/project/subloops/develop",
      label: "开发",
    });

    expect(group.directories).toEqual(expect.arrayContaining([
      expect.stringMatching(/\/prompts$/u),
      expect.stringMatching(/\/resources$/u),
      expect.stringMatching(/\/rules$/u),
      expect.stringMatching(/\/schemas$/u),
      expect.stringMatching(/\/skills$/u),
      expect.stringMatching(/\/templates$/u),
    ]));
    const paths = group.files.map(({ path }) => path);
    expect(paths).toEqual(expect.arrayContaining([
      expect.stringMatching(/\/stage\.yaml$/u),
      expect.stringMatching(/\/agents\.yaml$/u),
      expect.stringMatching(/\/prompts\/main\.md$/u),
      expect.stringMatching(/\/schemas\/output-schema\.json$/u),
      expect.stringMatching(/\/skills\/index\.yaml$/u),
      expect.stringMatching(/\/resources\/\.gitkeep$/u),
      expect.stringMatching(/\/rules\/\.gitkeep$/u),
      expect.stringMatching(/\/templates\/\.gitkeep$/u),
    ]));
    expect(paths.some((path) => path.endsWith("/agent.yaml"))).toBe(false);
    expect(paths.filter((path) => path.endsWith("output-schema.json"))).toHaveLength(1);
  });

  it("generates strict parseable stage, agent, Skill, and ExecResult contracts", () => {
    const group = createStagePackageFileGroup({
      loopId: "loop_project",
      subloopId: "develop",
      path: ".humanthread/loops/project/subloops/develop",
      label: "开发",
    });
    const content = (suffix: string) => group.files.find(({ path }) => path.endsWith(suffix))?.content;

    expect(stageConfigurationSchema.parse(parse(content("/stage.yaml")!))).toMatchObject({
      schemaVersion: 2,
      loopId: "loop_project",
      subloopId: "develop",
      configured: false,
      businessGoal: "",
      qualityGate: { minConfidence: 0.8 },
    });
    expect(stageAgentsSchema.parse(parse(content("/agents.yaml")!))).toEqual({
      schemaVersion: 1,
      executionMode: "SINGLE_WRITER",
      execRuns: [{ execId: "main", role: "primary", resumePolicy: "CHECKPOINT" }],
    });
    expect(stageSkillIndexSchema.parse(parse(content("/skills/index.yaml")!))).toEqual({
      schemaVersion: 1,
      mode: "none",
    });

    const outputSchema = JSON.parse(content("/schemas/output-schema.json")!);
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(outputSchema);
    expect(validate({
      execId: "main",
      status: "SUCCESS",
      issueType: "NONE",
      summary: "Stage completed.",
      confidence: 0.92,
      evidence: ["artifacts/test-report.json"],
      artifacts: ["artifacts/test-report.json"],
      checkpoint: { branch: "2026-HT100013", commit: "a".repeat(40) },
    })).toBe(true);
    expect(validate({ status: "SUCCESS" })).toBe(false);
  });
});

describe("Stage Package schemas", () => {
  it("parses v2 Catalog routing metadata without relaxing the v1 boundary", () => {
    const catalog = {
      contractVersion: 2,
      projectId: "project_1",
      catalogVersion: `sha256:${"a".repeat(64)}`,
      projectBindings: [],
      publishedLoops: [{
        loopDefinitionId: "loop_task",
        spaceId: "space_1",
        name: "Task Loop",
        description: null,
        scope: "task",
        origin: "space",
        readOnly: false,
        latestPublishedVersionId: "version_2",
        publishedVersions: [{
          loopVersionId: "version_2",
          versionNumber: 2,
          graph: {
            schemaVersion: 2,
            limits: { maxStages: 3, maxRepeatCount: 1 },
            nodes: [
              { key: "start", nodeId: "node_start", label: "Start", type: "start", offlinePolicy: "online_required" },
              {
                key: "develop",
                nodeId: "node_develop",
                label: "Develop",
                type: "agent_action",
                executionTarget: "local",
                offlinePolicy: "local_capable",
                responsibility: "Implement the approved requirement.",
                allowedRouteTargets: ["node_end"],
                reasoningEffort: "xhigh",
              },
              { key: "end", nodeId: "node_end", label: "End", type: "end", offlinePolicy: "online_required" },
            ],
            edges: [
              { id: "start-develop", source: "start", target: "develop", kind: "normal", outcome: "success" },
              { id: "develop-end", source: "develop", target: "end", kind: "normal", outcome: "success" },
            ],
          },
        }],
      }],
    };

    expect(projectLoopCatalogV2Schema.parse(catalog).contractVersion).toBe(2);
    expect(projectLoopCatalogV2Schema.parse(catalog).publishedLoops[0]!.publishedVersions[0]!.graph.nodes)
      .toContainEqual(expect.objectContaining({ type: "agent_action", reasoningEffort: "xhigh" }));
    expect(projectLoopCatalogSchema.safeParse(catalog).success).toBe(false);
    expect(projectLoopCatalogV2Schema.safeParse({
      ...catalog,
      publishedLoops: catalog.publishedLoops.map((loop) => ({
        ...loop,
        publishedVersions: loop.publishedVersions.map((version) => ({
          ...version,
          graph: {
            ...version.graph,
            nodes: version.graph.nodes.map((node) => node.type === "agent_action"
              ? { ...node, allowedRouteTargets: ["node_missing"] }
              : node),
          },
        })),
      })),
    }).success).toBe(false);
    expect(projectLoopCatalogV2Schema.safeParse({
      ...catalog,
      publishedLoops: catalog.publishedLoops.map((loop) => ({
        ...loop,
        publishedVersions: loop.publishedVersions.map((version) => ({
          ...version,
          graph: {
            ...version.graph,
            nodes: version.graph.nodes.map((node) => node.type === "start"
              ? { ...node, reasoningEffort: "xhigh" }
              : node),
          },
        })),
      })),
    }).success).toBe(false);
  });

  it("rejects runtime assignment fields and unsafe project paths", () => {
    expect(stageAgentsSchema.safeParse({
      schemaVersion: 1,
      executionMode: "SINGLE_WRITER",
      execRuns: [{ execId: "main", role: "primary", resumePolicy: "CHECKPOINT", workerId: "worker_1" }],
    }).success).toBe(false);
    expect(stageConfigurationSchema.safeParse({
      schemaVersion: 2,
      loopId: "loop_project",
      subloopId: "develop",
      configured: true,
      businessGoal: "Develop the change.",
      inputScope: { codeAccess: true, writeAccess: true, include: ["/tmp/**"], exclude: [], allowedCommands: [], blockedPaths: [] },
      resourceScope: { prompts: true, resources: true, rules: true, schemas: true, skills: true, templates: true },
      checklist: [],
      qualityGate: { checks: [], requiredArtifacts: [], minConfidence: 0.8 },
    }).success).toBe(false);
  });

  it("supports all, none, and unique explicit Skill selection", () => {
    expect(stageSkillIndexSchema.parse({ schemaVersion: 1, mode: "all" })).toEqual({ schemaVersion: 1, mode: "all" });
    expect(stageSkillIndexSchema.parse({ schemaVersion: 1, mode: "none" })).toEqual({ schemaVersion: 1, mode: "none" });
    expect(stageSkillIndexSchema.parse({
      schemaVersion: 1,
      mode: "include",
      skills: ["humanthread-mcp", "requirement-analysis"],
    })).toEqual({
      schemaVersion: 1,
      mode: "include",
      skills: ["humanthread-mcp", "requirement-analysis"],
    });
    expect(stageSkillIndexSchema.safeParse({
      schemaVersion: 1,
      mode: "include",
      skills: ["humanthread-mcp", "humanthread-mcp"],
    }).success).toBe(false);
  });

  it("accepts one bounded project-owned environment recovery policy", () => {
    const parsed = stageConfigurationSchema.parse({
      schemaVersion: 2,
      loopId: "loop_project",
      subloopId: "develop",
      configured: true,
      businessGoal: "Develop the change.",
      inputScope: {
        codeAccess: true,
        writeAccess: true,
        include: ["**/*"],
        exclude: [],
        allowedCommands: ["pnpm db:generate", "pnpm -r --sort build"],
        blockedPaths: [".env"],
      },
      resourceScope: { prompts: true, resources: true, rules: true, schemas: true, skills: true, templates: true },
      checklist: [],
      qualityGate: { checks: [], requiredArtifacts: [], minConfidence: 0.8 },
      autoRecovery: {
        maxAttempts: 1,
        issueTypes: ["ENVIRONMENT_GENERATED_TYPES_MISSING"],
        commands: ["pnpm db:generate", "pnpm -r --sort build"],
      },
    });

    expect(parsed.autoRecovery).toEqual({
      maxAttempts: 1,
      issueTypes: ["ENVIRONMENT_GENERATED_TYPES_MISSING"],
      commands: ["pnpm db:generate", "pnpm -r --sort build"],
    });
    expect(stageConfigurationSchema.safeParse({
      ...parsed,
      autoRecovery: { ...parsed.autoRecovery, maxAttempts: 2 },
    }).success).toBe(false);
  });

  it("keeps semantic gate checks separate from executable gate commands", () => {
    const base = {
      schemaVersion: 2 as const,
      loopId: "loop_project",
      subloopId: "develop",
      configured: true,
      businessGoal: "Develop the change.",
      inputScope: { codeAccess: true, writeAccess: true, include: ["**/*"], exclude: [], allowedCommands: ["pnpm test"], blockedPaths: [] },
      resourceScope: { prompts: true, resources: true, rules: true, schemas: true, skills: true, templates: true },
      checklist: [],
    };

    expect(stageConfigurationSchema.parse({
      ...base,
      qualityGate: {
        checks: ["the result has evidence"],
        commands: ["pnpm test"],
        requiredArtifacts: [],
        minConfidence: 0.8,
      },
    }).qualityGate).toMatchObject({
      checks: ["the result has evidence"],
      commands: ["pnpm test"],
    });
    expect(stageConfigurationSchema.safeParse({
      ...base,
      qualityGate: {
        checks: [],
        commands: ["pnpm build"],
        requiredArtifacts: [],
        minConfidence: 0.8,
      },
    }).success).toBe(false);
  });
});
