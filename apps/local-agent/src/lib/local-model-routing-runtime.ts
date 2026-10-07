import {
  resolveLocalModel,
  type LocalModelResolution,
  type LoopModelRouting,
  type ModelCatalog,
  type ModelSitesDocument,
} from "./local-model-configuration";
import { DEFAULT_REASONING_EFFORT, type ReasoningEffort } from "@humanthread/shared";
import type { AgentProvider } from "./execution-configuration";
import type { StructuredProviderExecutionInput } from "./providers/provider-adapter";

export type LocalModelExecutionOptions = Pick<
  StructuredProviderExecutionInput,
  "model" | "environmentOverrides" | "credentialContext" | "isolationContext" | "checklistMcp"
> & { reasoningEffort?: ReasoningEffort };

export type LocalModelExecutionInput = {
  loopDefinitionId: string;
  nodeId: string;
  provider: AgentProvider;
  deploymentOrigin: string;
  userId: string;
  platformReasoningEffort?: ReasoningEffort;
  sites: ModelSitesDocument;
  catalog: ModelCatalog;
  routing: LoopModelRouting;
};

function localModelError(error: unknown): Error {
  return Object.assign(
    new Error(error instanceof Error ? error.message : "Local model configuration is invalid"),
    { code: "local_model_configuration_invalid" },
  );
}

export function projectLocalModelExecution(
  input: LocalModelExecutionInput,
  resolution: LocalModelResolution,
): LocalModelExecutionOptions | undefined {
  const isolationContext = { deploymentOrigin: input.deploymentOrigin, userId: input.userId };
  if (resolution.source === "provider") {
    if (input.provider !== "codex") return undefined;
    return { reasoningEffort: input.platformReasoningEffort ?? DEFAULT_REASONING_EFFORT, isolationContext };
  }
  const { site, model } = resolution;
  if (site.adapter === "codex_environment") return {
    model: model.name,
    credentialContext: null,
    reasoningEffort: resolution.reasoningEffort,
    isolationContext,
  };
  return {
    model: model.name,
    reasoningEffort: resolution.reasoningEffort,
    isolationContext,
    ...(site.baseUrl ? { environmentOverrides: { OPENAI_BASE_URL: site.baseUrl } } : {}),
    ...(site.credentialSource === "independent" && site.credentialRef
      ? {
        credentialContext: {
          deploymentOrigin: input.deploymentOrigin,
          userId: input.userId,
          credentialRef: site.credentialRef,
        },
      }
      : { credentialContext: null }),
  };
}

export async function resolveLocalModelExecution(
  input: LocalModelExecutionInput,
): Promise<LocalModelExecutionOptions | undefined> {
  try {
    const resolution = resolveLocalModel({
      loopDefinitionId: input.loopDefinitionId,
      nodeId: input.nodeId,
      sites: input.sites.sites,
      catalog: input.catalog,
      routing: input.routing,
      accountDefault: input.sites.accountDefault,
    });
    return projectLocalModelExecution(input, resolution);
  } catch (error) {
    throw localModelError(error);
  }
}
