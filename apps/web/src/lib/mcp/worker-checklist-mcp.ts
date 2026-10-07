import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loopChecklistStatusSchema, RUNTIME_CHECKLIST_PROTOCOL_PROMPT } from "@humanthread/shared";

type LinuxWorkerChecklistBinding = {
  agentRunId: string;
  poolId: string;
  sessionId: string;
};

type LocalWorkerChecklistBinding = {
  agentRunId: string;
  workerId: string;
  deviceId: string;
  leaseGeneration: number;
};

export type WorkerChecklistMcpBinding = LinuxWorkerChecklistBinding | LocalWorkerChecklistBinding;

type ChecklistDependencies = {
  writeChecklist(input: WorkerChecklistMcpBinding & {
    operation: "create" | "update";
    payload: Record<string, unknown>;
  }): Promise<{ acceptedThroughSequence: number }>;
  /**
   * Opens the single runtime intervention for the Attempt bound to this MCP
   * session. The Agent decides when it is actually blocked; the platform
   * resolves the Attempt from the authenticated lease rather than trusting any
   * identity the model supplies.
   */
  requestIntervention?(input: WorkerChecklistMcpBinding & {
    commandId: string;
    reason: string;
    evidence?: unknown;
    pages?: Array<{ fileName: string; html: string }>;
  }): Promise<{ interactionId: string; status: string; loopRunId: string }>;
  /**
   * Reads back the intervention opened for this Attempt so a resumed stage can
   * learn what the human decided instead of asking the same question again.
   */
  readIntervention?(input: WorkerChecklistMcpBinding): Promise<{
    interactionId: string | null;
    status: string | null;
    decision: unknown;
    messages: unknown[];
  }>;
};

function toolResult(data: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
    structuredContent: data,
  };
}

const itemSchema = z.object({
  id: z.string().trim().min(1).max(128),
  title: z.string().trim().min(1).max(512),
  status: loopChecklistStatusSchema,
  reason: z.string().trim().min(1).max(4_000).optional(),
  evidenceRefs: z.array(z.string().trim().min(1).max(1_024)).max(100).default([]),
}).strict().superRefine((item, context) => {
  if ((item.status === "failed" || item.status === "skipped") && !item.reason) {
    context.addIssue({ code: "custom", message: "Failed and skipped checklist items require a reason", path: ["reason"] });
  }
});

export function createWorkerChecklistMcpServer(input: WorkerChecklistMcpBinding & {
  dependencies: ChecklistDependencies;
}) {
  const server = new McpServer({ name: "humanthread-worker-checklist", version: "1.0.0" });
  const { dependencies, ...binding } = input;

  // Codex probes resources/list during MCP startup. Register the protocol as
  // a read-only resource so that discovery succeeds instead of returning
  // JSON-RPC -32601 before the checklist tools are usable.
  server.registerResource(
    "execution_protocol",
    "humanthread://worker-checklist/protocol",
    { description: "HumanThread Worker execution checklist protocol", mimeType: "text/plain" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/plain", text: RUNTIME_CHECKLIST_PROTOCOL_PROMPT }] }),
  );

  server.registerTool("create_runtime_checklist", {
    description: "Create the concrete execution checklist for the current leased Loop node. Call once before completing the node.",
    inputSchema: { checklist: z.array(itemSchema).min(1).max(128) },
  }, async (arguments_) => toolResult(await dependencies.writeChecklist({
    ...binding,
    operation: "create",
    payload: { checklist: arguments_.checklist },
  })));

  server.registerTool("update_runtime_checklist", {
    description: "Update one item in the current leased Loop node checklist as work progresses.",
    inputSchema: {
      itemId: z.string().trim().min(1).max(128),
      status: loopChecklistStatusSchema,
      reason: z.string().trim().min(1).max(4_000).optional(),
      evidenceRefs: z.array(z.string().trim().min(1).max(1_024)).max(100).default([]),
    },
  }, async (arguments_) => {
    if ((arguments_.status === "failed" || arguments_.status === "skipped") && !arguments_.reason) {
      throw new Error("Failed and skipped checklist updates require a reason");
    }
    return toolResult(await dependencies.writeChecklist({
      ...binding,
      operation: "update",
      payload: arguments_,
    }));
  });

  // A stage Agent is the only actor that knows when it is genuinely blocked
  // (missing upstream output, an ambiguous requirement, a decision only a
  // human can make). Exposing this here lets it ask instead of finishing the
  // turn with prose that the platform would otherwise treat as success.
  server.registerTool("request_workflow_intervention", {
    description: "Ask a human to resolve a blocker for the current Loop stage. The stage stops and waits until the human answers. Attach rendered HTML pages when the human needs to read a document or review page.",
    inputSchema: {
      commandId: z.string().trim().min(1).max(128),
      reason: z.string().trim().min(1).max(20_000),
      evidence: z.unknown().optional(),
      // Pages are carried inline and served from a short-lived proxy. They are
      // deliberately not platform artifacts, so the Agent must not rely on a
      // repository path being readable after the interaction ends.
      pages: z.array(z.object({
        fileName: z.string().trim().min(1).max(191),
        html: z.string().min(1).max(524_288),
      }).strict()).max(4).optional(),
    },
  }, async (arguments_) => {
    if (!dependencies.requestIntervention) {
      throw new Error("Runtime intervention is unavailable for this Worker session");
    }
    return toolResult(await dependencies.requestIntervention({
      ...binding,
      commandId: arguments_.commandId,
      reason: arguments_.reason,
      ...(arguments_.evidence === undefined ? {} : { evidence: arguments_.evidence }),
      ...(arguments_.pages === undefined ? {} : { pages: arguments_.pages }),
    }));
  });

  server.registerTool("get_workflow_intervention", {
    description: "Read the human decision and discussion for the current Loop stage after it resumes.",
    inputSchema: {},
  }, async () => {
    if (!dependencies.readIntervention) {
      throw new Error("Runtime intervention is unavailable for this Worker session");
    }
    return toolResult(await dependencies.readIntervention({ ...binding }));
  });

  return server;
}
