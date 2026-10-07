import type {
  AgentProviderAdapter,
  NormalizedRunEvent,
  StructuredProviderExecutionInput,
} from "./provider-adapter";

type ClaudeQuery = (input: {
  prompt: string;
  options: {
    cwd: string;
    abortController: AbortController;
    resume?: string;
    tools?: string[] | { type: "preset"; preset: "claude_code" };
    permissionMode?: "default" | "acceptEdits" | "plan" | "dontAsk";
    model?: string;
  };
}) => AsyncIterable<Record<string, unknown>>;

function normalize(message: Record<string, unknown>): NormalizedRunEvent | null {
  if (message.type === "system" && message.subtype === "init") return { type: "run.started", ...(typeof message.session_id === "string" ? { providerSessionId: message.session_id } : {}) };
  if (message.type === "permission_request") return { type: "approval.requested", payload: { tool: message.tool_name, input: message.input } };
  if (message.type === "assistant" && message.message && typeof message.message === "object") {
    const content = (message.message as { content?: Array<{ type?: string; text?: string }> }).content ?? [];
    return { type: "agent.message.completed", text: content.filter((item) => item.type === "text").map((item) => item.text ?? "").join("") };
  }
  if (message.type === "result" && message.subtype === "success") return { type: "run.completed", result: message.structured_output ?? message.result ?? {}, ...(message.usage === undefined ? {} : { usage: message.usage }) };
  if (message.type === "result") return { type: "run.failed", errorCode: "provider_error", message: typeof message.result === "string" ? message.result.slice(0, 512) : "Claude run failed" };
  return null;
}

export function createClaudeAdapter(dependencies: { query: ClaudeQuery }): AgentProviderAdapter {
  let controller: AbortController | null = null;
  const execute = async function* (input: {
    cwd: string;
    prompt: string;
    signal?: AbortSignal;
    providerSessionId?: string;
    tools?: string[] | { type: "preset"; preset: "claude_code" };
    permissionMode?: "default" | "acceptEdits" | "plan" | "dontAsk";
    model?: string;
  }) {
    controller = new AbortController();
    input.signal?.addEventListener("abort", () => controller?.abort(), { once: true });
    try {
      for await (const message of dependencies.query({
        prompt: input.prompt,
        options: {
          cwd: input.cwd,
          abortController: controller,
          ...(input.providerSessionId ? { resume: input.providerSessionId } : {}),
          ...(input.tools ? { tools: input.tools } : {}),
          ...(input.permissionMode ? { permissionMode: input.permissionMode } : {}),
          ...(input.model ? { model: input.model } : {}),
        },
      })) {
        const event = normalize(message);
        if (event) yield event;
      }
    } catch (error) {
      yield { type: controller.signal.aborted ? "run.cancelled" as const : "run.failed" as const, ...(controller.signal.aborted ? {} : { errorCode: "provider_error", message: error instanceof Error ? error.message.slice(0, 512) : "Claude query failed" }) } as NormalizedRunEvent;
    }
  };
  return {
    capabilities: () => ({ sessionResume: true, structuredResult: true, approvals: true }),
    executeStructured(input: StructuredProviderExecutionInput) {
      const prompt = `${input.prompt}\n\nReturn the final result as one JSON object conforming to the JSON Schema at ${input.resultSchemaPath}`;
      const routerPolicy = input.mode === "router"
        ? { tools: [] as string[], permissionMode: "dontAsk" as const }
        : {};
      return execute({
        ...input,
        prompt,
        ...(input.providerSessionId ? { providerSessionId: input.providerSessionId } : {}),
        ...routerPolicy,
        ...(input.model ? { model: input.model } : {}),
      });
    },
    start: (input) => execute(input),
    resume: (input) => execute({ ...input, providerSessionId: input.providerSessionId }),
    async cancel() { controller?.abort(); controller = null; },
  };
}
