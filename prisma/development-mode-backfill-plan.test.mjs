import { describe, expect, it } from "vitest";
import { planDevelopmentModeBackfill, summarizeDevelopmentModeBackfill } from "./development-mode-backfill-plan.mjs";

describe("planDevelopmentModeBackfill", () => {
  it("leaves existing projects unconfigured instead of guessing branches", () => {
    const result = planDevelopmentModeBackfill({
      projects: [
        { id: "project_1", developmentTemplateKey: null, developmentTemplateVersion: null, productionBranch: null, stagingBranch: null },
        {
          id: "project_2",
          developmentTemplateKey: "legacy",
          developmentTemplateVersion: 1,
          developmentTemplateConfig: {},
          productionBranch: "main",
          stagingBranch: "staging",
          releaseAgentProfileId: "profile_release",
        },
      ],
    });

    expect(result).toEqual({ updates: [], errors: [] });
    expect(summarizeDevelopmentModeBackfill({
      projects: [{ id: "project_1", developmentTemplateKey: null, developmentTemplateVersion: null, productionBranch: null, stagingBranch: null }],
    })).toEqual({ processed: 1, updated: 0, skipped: 1, errors: 0 });
  });

  it("reports partially configured projects for manual reconciliation", () => {
    expect(planDevelopmentModeBackfill({
      projects: [{ id: "project_1", developmentTemplateKey: "branch-development", developmentTemplateVersion: null, productionBranch: "main", stagingBranch: null }],
    })).toEqual({
      updates: [],
      errors: [{ id: "project_1", code: "partial_configuration" }],
    });
  });

  it("includes template config and release profile in partial-configuration detection", () => {
    expect(planDevelopmentModeBackfill({
      projects: [{
        id: "project_1",
        developmentTemplateKey: null,
        developmentTemplateVersion: null,
        developmentTemplateConfig: null,
        productionBranch: null,
        stagingBranch: null,
        releaseAgentProfileId: "profile_release",
      }],
    })).toEqual({
      updates: [],
      errors: [{ id: "project_1", code: "partial_configuration" }],
    });
  });
});
