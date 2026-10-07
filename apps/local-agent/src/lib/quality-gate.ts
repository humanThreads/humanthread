import Ajv2020 from "ajv/dist/2020.js";

import type { StageChecklistItem, StageQualityGate } from "@humanthread/project-loop-sync";

export type StageGateCheck = { name: string; passed: boolean; summary: string };
export type StageGateResult = {
  passed: boolean;
  issueType: string;
  summary: string;
  evidence: string[];
  checks: StageGateCheck[];
};

type StageExecResult = {
  execId: string;
  status: string;
  issueType: string;
  summary: string;
  confidence: number;
  evidence: string[];
  artifacts: string[];
  checkpoint: unknown;
};

const SAFE_PATH = /^(?!\/)(?![A-Za-z]:)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\).+$/u;

function failed(issueType: string, summary: string, evidence: string[], checks: StageGateCheck[] = []): StageGateResult {
  return { passed: false, issueType, summary, evidence, checks };
}

function parseResult(result: unknown, outputSchema: Record<string, unknown>): StageExecResult | null {
  try {
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(outputSchema);
    if (!validate(result)) return null;
  } catch {
    return null;
  }
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const value = result as Record<string, unknown>;
  if (
    typeof value.execId !== "string"
    || typeof value.status !== "string"
    || typeof value.issueType !== "string"
    || typeof value.summary !== "string"
    || typeof value.confidence !== "number"
    || !Array.isArray(value.evidence)
    || !value.evidence.every((path) => typeof path === "string")
    || !Array.isArray(value.artifacts)
    || !value.artifacts.every((path) => typeof path === "string")
  ) return null;
  return value as StageExecResult;
}

export async function evaluateStageQualityGate(input: {
  result: unknown;
  qualityGate: StageQualityGate;
  checklist: StageChecklistItem[];
  outputSchema: Record<string, unknown>;
  workspace: {
    readText(path: string): Promise<string | null>;
    runCheck(command: string): Promise<{ passed: boolean; summary: string }>;
  };
}): Promise<StageGateResult> {
  const result = parseResult(input.result, input.outputSchema);
  if (!result) return failed("INVALID_EXEC_RESULT", "Stage result does not match its output contract", []);
  const evidence = [...new Set([...result.evidence, ...result.artifacts])];
  if (evidence.some((path) => !SAFE_PATH.test(path))) {
    return failed("INVALID_ARTIFACT_PATH", "Stage evidence contains a path outside the Workspace", evidence);
  }
  if (result.status !== "SUCCESS") {
    return failed(result.issueType || "STAGE_EXECUTION_FAILED", result.summary, evidence);
  }
  if (result.confidence < input.qualityGate.minConfidence) {
    return failed("CONFIDENCE_BELOW_THRESHOLD", "Stage confidence is below the configured threshold", evidence);
  }
  const declared = new Set(evidence);
  for (const path of input.qualityGate.requiredArtifacts) {
    if (!SAFE_PATH.test(path)) return failed("INVALID_ARTIFACT_PATH", `Required artifact path is unsafe: ${path}`, evidence);
    if (!declared.has(path)) return failed("MISSING_REQUIRED_ARTIFACT", `Required artifact was not reported: ${path}`, evidence);
    const content = await input.workspace.readText(path);
    if (content === null || content.length === 0) return failed("MISSING_REQUIRED_ARTIFACT", `Required artifact is missing: ${path}`, evidence);
    if (path.endsWith(".json")) {
      try { JSON.parse(content); } catch { return failed("INVALID_REQUIRED_ARTIFACT", `Required JSON artifact is invalid: ${path}`, evidence); }
    }
  }
  for (const item of input.checklist) {
    for (const path of item.evidence) {
      if (!SAFE_PATH.test(path)) return failed("INVALID_ARTIFACT_PATH", `Checklist evidence path is unsafe: ${path}`, evidence);
      if (!declared.has(path) || await input.workspace.readText(path) === null) {
        return failed("CHECKLIST_INCOMPLETE", `Checklist evidence is incomplete for ${item.id}`, evidence);
      }
    }
  }
  const checks: StageGateCheck[] = [];
  for (const command of input.qualityGate.commands ?? []) {
    const result = await input.workspace.runCheck(command);
    checks.push({ name: command, ...result });
    if (!result.passed) return failed("CONFIGURED_CHECK_FAILED", `Configured check failed: ${command}`, evidence, checks);
  }
  return { passed: true, issueType: "NONE", summary: result.summary, evidence, checks };
}
