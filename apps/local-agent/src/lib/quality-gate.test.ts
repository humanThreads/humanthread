import { describe, expect, it, vi } from "vitest";

import { evaluateStageQualityGate } from "./quality-gate";

const qualityGate = {
  minConfidence: 0.8,
  requiredArtifacts: ["artifacts/test/report.json"],
  checks: ["the test report is complete"],
  commands: ["pnpm test"],
};

describe("evaluateStageQualityGate", () => {
  it("fails when required evidence is absent", async () => {
    const gate = await evaluateStageQualityGate({
      result: { execId: "main", status: "SUCCESS", issueType: "NONE", summary: "Done", confidence: 0.9, evidence: [], artifacts: [], checkpoint: null },
      qualityGate,
      checklist: [],
      outputSchema: { type: "object" },
      workspace: { readText: vi.fn().mockResolvedValue(null), runCheck: vi.fn() },
    });
    expect(gate).toMatchObject({ passed: false, issueType: "MISSING_REQUIRED_ARTIFACT" });
  });

  it("passes only after schema, artifacts, checklist, checks, and confidence pass", async () => {
    const readText = vi.fn(async (path: string) => path.endsWith(".json") ? "{}" : "evidence");
    const gate = await evaluateStageQualityGate({
      result: {
        execId: "main", status: "SUCCESS", issueType: "NONE", summary: "Done", confidence: 0.9,
        evidence: ["artifacts/test/report.json", "artifacts/checklist.txt"],
        artifacts: ["artifacts/test/report.json"], checkpoint: { branch: "2026-HT100013", commit: "abc123" },
      },
      qualityGate,
      checklist: [{ id: "verify", title: "Verify", fingerprintInputs: [], evidence: ["artifacts/checklist.txt"], reusePolicy: "VERIFY" }],
      outputSchema: { type: "object", required: ["status"] },
      workspace: { readText, runCheck: vi.fn().mockResolvedValue({ passed: true, summary: "passed" }) },
    });
    expect(gate).toMatchObject({ passed: true, issueType: "NONE" });
  });

  it("does not execute semantic quality checks as shell commands", async () => {
    const runCheck = vi.fn().mockResolvedValue({ passed: true, summary: "passed" });

    const gate = await evaluateStageQualityGate({
      result: {
        execId: "main", status: "SUCCESS", issueType: "NONE", summary: "Done", confidence: 0.9,
        evidence: [], artifacts: [], checkpoint: null,
      },
      qualityGate: {
        minConfidence: 0.8,
        requiredArtifacts: [],
        checks: ["ExecResult status is SUCCESS", "summary and evidence are present"],
      },
      checklist: [],
      outputSchema: { type: "object" },
      workspace: { readText: vi.fn(), runCheck },
    });

    expect(gate.passed).toBe(true);
    expect(runCheck).not.toHaveBeenCalled();
  });

  it("rejects evidence paths outside the Workspace before reading them", async () => {
    const readText = vi.fn();
    const gate = await evaluateStageQualityGate({
      result: { execId: "main", status: "SUCCESS", issueType: "NONE", summary: "Done", confidence: 0.9, evidence: ["../secret"], artifacts: [], checkpoint: null },
      qualityGate: { minConfidence: 0, requiredArtifacts: [], checks: [] },
      checklist: [],
      outputSchema: { type: "object" },
      workspace: { readText, runCheck: vi.fn() },
    });
    expect(gate).toMatchObject({ passed: false, issueType: "INVALID_ARTIFACT_PATH" });
    expect(readText).not.toHaveBeenCalled();
  });
});
