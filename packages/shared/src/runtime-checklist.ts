import {
  loopChecklistItemSchema,
  loopChecklistStatusSchema,
  type LoopChecklistItem,
  type LoopChecklistStatus,
} from "./loop-engine";
import { z } from "zod";

/**
 * Provider-facing contract for the one low-frequency runtime checklist
 * message. The execution adapters parse only this fenced JSON block.
 */
export const RUNTIME_CHECKLIST_PROTOCOL_PROMPT = [
  "In your first complete assistant message, include one standalone fenced JSON block with this exact top-level key:",
  "```json",
  '{"humanThreadChecklist":[{"id":"inspect_repository","title":"Inspect repository","status":"not_started","reason":null,"evidenceRefs":[]}]}',
  "```",
  "The humanThreadChecklist array must contain the concrete work items for this node. For later status changes, emit another standalone fenced JSON block with humanThreadChecklistUpdates, for example {\"humanThreadChecklistUpdates\":[{\"itemId\":\"inspect_repository\",\"status\":\"succeeded\",\"evidenceRefs\":[]}]}. Allowed statuses are not_started, in_progress, succeeded, failed, and skipped. Failed or skipped items must include a non-empty reason. evidenceRefs must be an array (use [] when there is no platform-issued evidence reference). Do not include credentials, prompts, or arbitrary fields in these blocks.",
  "When the humanthread_checklist MCP server is available, use create_runtime_checklist once and update_runtime_checklist after each status change; the fenced block is the fallback representation for clients without tool calls.",
  "If you cannot complete this stage because a human decision or missing upstream state blocks you, call request_workflow_intervention with a concrete reason instead of ending the turn as if the stage succeeded. When the human needs to read a rendered page to answer, attach it with the pages argument as { fileName, html } rather than describing it in prose or writing it to the repository. Use get_workflow_intervention after resuming to read the human's decision. Do not invent values for missing state and do not silently skip the blocked work; if neither tool is available, report the blocker explicitly in your final message.",
].join("\n");

const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_CHECKLIST_BLOCK_BYTES = 64 * 1024;

function byteLength(value: string): number {
  // The protocol limit is intentionally conservative; UTF-16 code units are
  // sufficient to reject oversized provider messages without a runtime DOM API.
  return value.length;
}

export const runtimeChecklistUpdateSchema = z.object({
  itemId: z.string().trim().min(1).max(128),
  status: loopChecklistStatusSchema,
  reason: z.string().trim().min(1).max(4_000).optional(),
  evidenceRefs: z.array(z.string().min(1).max(1_024)).max(100).default([]),
}).strict().superRefine((update, context) => {
  if ((update.status === "failed" || update.status === "skipped") && update.reason === undefined) {
    context.addIssue({ code: "custom", message: "Failed and skipped checklist updates require a reason", path: ["reason"] });
  }
});
export type RuntimeChecklistUpdate = z.infer<typeof runtimeChecklistUpdateSchema>;

function parseChecklistBlocks(text: string): unknown[] {
  if (typeof text !== "string" || byteLength(text) > MAX_MESSAGE_BYTES) return [];
  const decoded: unknown[] = [];
  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/giu)) {
    const raw = match[1]?.trim();
    if (!raw || byteLength(raw) > MAX_CHECKLIST_BLOCK_BYTES) continue;
    try { decoded.push(JSON.parse(raw)); } catch { /* a provider message is not a task failure */ }
  }
  return decoded;
}

/**
 * Parse only an explicit fenced JSON checklist. Natural-language responses,
 * deltas, and malformed blocks return null so provider execution can proceed.
 */
export function parseRuntimeChecklistMessage(text: string): LoopChecklistItem[] | null {
  for (const decoded of parseChecklistBlocks(text)) {
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) continue;
    const candidate = Reflect.get(decoded, "humanThreadChecklist");
    if (!Array.isArray(candidate)) continue;
    const normalized = candidate.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return item;
      const value = item as Record<string, unknown>;
      const { reason, ...rest } = value;
      return {
        ...rest,
        ...(reason === null || reason === undefined ? {} : { reason }),
        evidenceRefs: value.evidenceRefs === undefined ? [] : value.evidenceRefs,
      };
    });
    const ids = normalized.map((item) => item && typeof item === "object" && !Array.isArray(item)
      ? Reflect.get(item, "id")
      : undefined);
    if (ids.some((id) => typeof id !== "string") || new Set(ids).size !== ids.length) continue;
    const parsed = loopChecklistItemSchema.array().min(1).max(128).safeParse(normalized);
    if (!parsed.success) continue;
    return parsed.data;
  }
  return null;
}

export function parseRuntimeChecklistUpdatesMessage(text: string): RuntimeChecklistUpdate[] | null {
  for (const decoded of parseChecklistBlocks(text)) {
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) continue;
    const candidate = Reflect.get(decoded, "humanThreadChecklistUpdates");
    if (!Array.isArray(candidate) || candidate.length === 0 || candidate.length > 128) continue;
    const normalized = candidate.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return item;
      const value = item as Record<string, unknown>;
      const { reason, ...rest } = value;
      return { ...rest, ...(reason === null || reason === undefined ? {} : { reason }), evidenceRefs: value.evidenceRefs ?? [] };
    });
    const parsed = runtimeChecklistUpdateSchema.array().min(1).max(128).safeParse(normalized);
    if (parsed.success) return parsed.data;
  }
  return null;
}
