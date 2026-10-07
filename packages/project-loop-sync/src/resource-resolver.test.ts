import { describe, expect, it } from "vitest";

import type { ProjectLoopStageContract, StageSkillSelection } from "./contracts";
import { resolveStageResources } from "./resource-resolver";

const stagePath = ".humanthread/loops/project/subloops/develop";

function stage(skillSelection: StageSkillSelection): ProjectLoopStageContract {
  return {
    loopId: "loop_project",
    subloopId: "develop",
    stagePath,
    configured: true,
    businessGoal: "Implement the approved requirement.",
    inputScope: { codeAccess: true, writeAccess: true, include: [], exclude: [], allowedCommands: [], blockedPaths: [] },
    resourceScope: { prompts: true, resources: true, rules: true, schemas: true, skills: true, templates: true },
    checklist: [],
    qualityGate: { checks: [], requiredArtifacts: [], minConfidence: 0.8 },
    agents: { schemaVersion: 1, executionMode: "SINGLE_WRITER", execRuns: [{ execId: "main", role: "primary", resumePolicy: "CHECKPOINT" }] },
    skillSelection,
    outputSchema: { type: "object" },
    fingerprint: `sha256:${"a".repeat(64)}`,
  };
}

function fixture(skillSelection: StageSkillSelection, overrides: Record<string, string> = {}) {
  const files: Record<string, string> = {
    [`${stagePath}/prompts/main.md`]: "Default prompt\n",
    [`${stagePath}/prompts/review.md`]: "Review prompt\n",
    [`${stagePath}/rules/project.md`]: "Project rule\n",
    [`${stagePath}/resources/mapping.json`]: '{"key":"value"}\n',
    [`${stagePath}/resources/image.png`]: "binary",
    [`${stagePath}/schemas/output-schema.json`]: '{"type":"object"}\n',
    [`${stagePath}/templates/report.md`]: "# Report\n",
    ".agents/skills/humanthread-mcp/SKILL.md": "# HumanThread MCP\n",
    ".agents/skills/requirement-analysis/SKILL.md": "# Requirement Analysis\n",
    ...overrides,
  };
  return {
    stage: stage(skillSelection),
    readText: async (path: string) => files[path] ?? null,
    listTree: async (path: string) => Object.keys(files).filter((file) => file.startsWith(`${path}/`)).sort(),
  };
}

describe("resolveStageResources", () => {
  const selections: Array<[StageSkillSelection, string[]]> = [
    [{ schemaVersion: 1, mode: "all" }, ["humanthread-mcp", "requirement-analysis"]],
    [{ schemaVersion: 1, mode: "none" }, []],
    [{ schemaVersion: 1, mode: "include", skills: ["requirement-analysis"] }, ["requirement-analysis"]],
  ];
  it.each(selections)("resolves Skill selection %j", async (selection, expected) => {
    const result = await resolveStageResources({ ...fixture(selection), execId: "main" });
    expect(result.skills.map((skill) => skill.key)).toEqual(expected);
  });

  it("selects an exec prompt, ignores binary resources, truncates text resources, and loads a Skill completely", async () => {
    const longRule = "r".repeat(30_000);
    const longSkill = `# Complete Skill\n${"s".repeat(30_000)}`;
    const result = await resolveStageResources({
      ...fixture(
        { schemaVersion: 1, mode: "include", skills: ["humanthread-mcp"] },
        {
          [`${stagePath}/rules/project.md`]: longRule,
          ".agents/skills/humanthread-mcp/SKILL.md": longSkill,
        },
      ),
      execId: "review",
    });

    expect(result.prompt).toBe("Review prompt\n");
    expect(result.resources.map(({ path }) => path)).not.toContain(`${stagePath}/resources/image.png`);
    expect(result.rules[0]?.content).toHaveLength(24_000);
    expect(result.skills[0]?.content).toBe(longSkill);
    expect(result.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("rejects a missing or escaping explicit Skill instead of silently dropping it", async () => {
    await expect(resolveStageResources({
      ...fixture({ schemaVersion: 1, mode: "include", skills: ["missing-skill"] }),
      execId: "main",
    })).rejects.toMatchObject({ code: "stage_skill_missing" });
    await expect(resolveStageResources({
      ...fixture({ schemaVersion: 1, mode: "include", skills: ["../escape"] } as never),
      execId: "main",
    })).rejects.toMatchObject({ code: "invalid_stage_skill_index" });
  });

  it.each([
    [[".agents/skills/Invalid/SKILL.md"], "invalid Skill path"],
    [[".agents/skills/humanthread-mcp/SKILL.md", ".agents/skills/humanthread-mcp/SKILL.md"], "duplicate Skill path"],
  ])("rejects %s while resolving mode all", async (skillPaths) => {
    const base = fixture({ schemaVersion: 1, mode: "all" });
    await expect(resolveStageResources({
      ...base,
      execId: "main",
      listTree: async (path) => path === ".agents/skills" ? skillPaths : base.listTree(path),
    })).rejects.toMatchObject({ code: "invalid_stage_skill_index" });
  });

  it("rejects an unsafe exec ID before resolving a prompt path", async () => {
    await expect(resolveStageResources({
      ...fixture({ schemaVersion: 1, mode: "none" }),
      execId: "../escape",
    })).rejects.toMatchObject({ code: "invalid_stage_exec_id" });
  });

  it("rejects selected Skills that cannot fit completely in the bounded context", async () => {
    await expect(resolveStageResources({
      ...fixture(
        { schemaVersion: 1, mode: "include", skills: ["humanthread-mcp"] },
        { ".agents/skills/humanthread-mcp/SKILL.md": "s".repeat(128 * 1024) },
      ),
      execId: "main",
    })).rejects.toMatchObject({ code: "stage_resource_context_too_large" });
  });
});
