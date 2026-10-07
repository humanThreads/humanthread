import type { CodexExecutionPolicy } from "../workspace-policy";
import type { LoopAssignment } from "@humanthread/shared";
import type { ReasoningEffort } from "@humanthread/shared";
import type { AgentProvider, LocalRuntimeConfiguration } from "../execution-configuration";

export type NormalizedRunEvent =
  | {
    type: "run.started";
    providerSessionId?: string;
    providerBindingFingerprint?: string;
    providerTransport?: "codex_app_server" | "codex_cli";
    providerGeneration?: number;
    providerTurnId?: string;
  }
  | { type: "agent.message.completed"; text: string }
  | { type: "tool.requested" | "tool.started" | "tool.completed"; tool: string; payload: unknown }
  | { type: "approval.requested"; payload: unknown }
  | { type: "checkpoint.created"; payload: unknown }
  | { type: "artifact.produced"; payload: unknown }
  | { type: "run.completed"; result: unknown; usage?: unknown }
  | { type: "run.failed"; errorCode: string; message: string }
  | { type: "run.cancelled" };

export type StructuredProviderExecutionInput = {
  runId?: string;
  cwd: string;
  prompt: string;
  resultSchemaPath: string;
  executionPolicy: CodexExecutionPolicy;
  mode: "stage" | "router";
  providerSessionId?: string;
  providerBindingFingerprint?: string;
  providerTransport?: "codex_app_server" | "codex_cli";
  providerGeneration?: number;
  providerTurnId?: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  environmentOverrides?: Record<string, string>;
  credentialContext?: {
    deploymentOrigin: string;
    userId: string;
    credentialRef: string;
  } | null;
  isolationContext?: {
    deploymentOrigin: string;
    userId: string;
  };
  checklistMcp?: {
    url: string;
    headers: Record<string, string>;
  };
  signal?: AbortSignal;
};

export interface AgentProviderAdapter {
  capabilities(): { sessionResume: boolean; structuredResult: boolean; approvals: boolean };
  /**
   * Projects the repository-owned Schema into the Provider's structured-output
   * dialect. The original Schema remains authoritative for local validation.
   */
  projectStructuredOutputSchema?(schema: unknown): unknown;
  executeStructured(input: StructuredProviderExecutionInput): AsyncIterable<NormalizedRunEvent>;
  start(input: { cwd: string; prompt: string; resultSchemaPath: string; executionPolicy: CodexExecutionPolicy; model?: string; reasoningEffort?: ReasoningEffort; environmentOverrides?: Record<string, string>; credentialContext?: StructuredProviderExecutionInput["credentialContext"]; isolationContext?: StructuredProviderExecutionInput["isolationContext"]; checklistMcp?: StructuredProviderExecutionInput["checklistMcp"]; signal?: AbortSignal }): AsyncIterable<NormalizedRunEvent>;
  resume(input: { cwd: string; prompt: string; providerSessionId: string; providerBindingFingerprint?: string; providerTransport?: "codex_app_server" | "codex_cli"; providerGeneration?: number; providerTurnId?: string; resultSchemaPath: string; executionPolicy: CodexExecutionPolicy; model?: string; reasoningEffort?: ReasoningEffort; environmentOverrides?: Record<string, string>; credentialContext?: StructuredProviderExecutionInput["credentialContext"]; isolationContext?: StructuredProviderExecutionInput["isolationContext"]; checklistMcp?: StructuredProviderExecutionInput["checklistMcp"]; signal?: AbortSignal }): AsyncIterable<NormalizedRunEvent>;
  cancel(input: { providerSessionId?: string }): Promise<void>;
}

export type ProviderAdapterRegistry = Partial<Record<AgentProvider, AgentProviderAdapter>>;

export function resolveProviderAdapter(
  expected: LoopAssignment["runtime"],
  local: LocalRuntimeConfiguration | null,
  registry: ProviderAdapterRegistry,
): AgentProviderAdapter {
  const adapter = registry[expected.provider];
  if (
    !local
    || !adapter
    || local.provider !== expected.provider
  ) {
    throw Object.assign(new Error("Local Agent runtime configuration is stale"), {
      code: "runtime_configuration_stale",
    });
  }
  return adapter;
}

export interface ProviderProcess {
  stdout: Iterable<string> | AsyncIterable<string>;
  stderr: Iterable<string> | AsyncIterable<string>;
  wait(): Promise<{ code: number | null; signal: string | null }>;
  cancel(): void;
}

export interface ProviderSpawn {
  (command: string, args: string[], options: {
    cwd: string;
    signal?: AbortSignal;
    environmentOverrides?: Record<string, string>;
    credentialContext?: StructuredProviderExecutionInput["credentialContext"];
  }): ProviderProcess;
}
