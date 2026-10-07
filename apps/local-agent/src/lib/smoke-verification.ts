import type { LocalAgentSmokeInput, LocalAgentSmokeResult } from "./smoke.ts";
import { runLocalAgentSmoke } from "./smoke.ts";
import type { AgentEventVerificationSummary } from "./agent-event-verification-report.ts";

export interface VerifyAgentEventsInput {
  taskId?: string;
  take?: number;
  expectedTypes?: string[];
  latestOnly?: boolean;
}

export interface SmokeAndVerifyInput {
  smokeInput: LocalAgentSmokeInput;
  verifyInput: {
    take?: number;
  };
}

interface SmokeAndVerifyDependencies {
  runSmoke: (input: LocalAgentSmokeInput) => Promise<LocalAgentSmokeResult>;
  runVerify: (
    input: Required<Pick<VerifyAgentEventsInput, "taskId" | "expectedTypes" | "latestOnly">> &
      Pick<VerifyAgentEventsInput, "take">,
  ) => Promise<AgentEventVerificationSummary>;
}

export interface SmokeAndVerifyResult {
  smoke: LocalAgentSmokeResult;
  verify: AgentEventVerificationSummary | null;
}

export async function runSmokeAndVerifyEvents(
  input: SmokeAndVerifyInput,
  dependencies: SmokeAndVerifyDependencies,
): Promise<SmokeAndVerifyResult> {
  const smoke = await dependencies.runSmoke(input.smokeInput);

  if (!smoke.taskId) {
    return {
      smoke,
      verify: null,
    };
  }

  const verify = await dependencies.runVerify({
    taskId: smoke.taskId,
    expectedTypes: smoke.reportedEventTypes,
    latestOnly: true,
    ...(typeof input.verifyInput.take === "number"
      ? { take: input.verifyInput.take }
      : {}),
  });

  return {
    smoke,
    verify,
  };
}

export const defaultSmokeAndVerifyDependencies = {
  runSmoke: runLocalAgentSmoke,
};
