import { z } from "zod";
import {
  reasoningEffortSchema,
  type ReasoningEffort,
} from "@humanthread/shared";

export type { ReasoningEffort } from "@humanthread/shared";

export const REASONING_EFFORT_OPTIONS = [
  ["low", "Low"],
  ["medium", "Medium"],
  ["high", "High"],
  ["xhigh", "XHigh"],
  ["max", "Max"],
  ["ultra", "Ultra"],
] as const satisfies readonly (readonly [ReasoningEffort, string])[];

const HEX_MD5 = /^[0-9a-f]{32}$/u;
const SAFE_LOCAL_ID = /^[A-Za-z0-9_-]{1,128}$/u;
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/u;

export const localModelCatalogSchemaVersion = 1 as const;
export const localModelSelectionSchemaVersion = 2 as const;

export const modelSiteAdapterSchema = z.enum([
  "codex_environment",
  "openai_compatible",
  "ollama",
  "lmstudio",
]);
export type ModelSiteAdapter = z.infer<typeof modelSiteAdapterSchema>;

export const modelSiteStatusSchema = z.enum([
  "ready",
  "needs_revalidation",
  "connection_failed",
  "untested",
]);

export const modelSelectionSchema = z.object({
  siteId: z.string().regex(HEX_MD5),
  modelKey: z.string().regex(HEX_MD5),
  reasoningEffort: reasoningEffortSchema,
}).strict();
export type ModelSelection = z.infer<typeof modelSelectionSchema>;

export const modelSiteSchema = z.object({
  siteId: z.string().regex(HEX_MD5),
  name: z.string().trim().min(1).max(128).refine((value) => !CONTROL_CHARACTERS.test(value)),
  adapter: modelSiteAdapterSchema,
  baseUrl: z.string().trim().max(2_048).nullable().refine(
    (value) => value === null || (!CONTROL_CHARACTERS.test(value) && /^https?:\/\//iu.test(value)),
    "Model site URL must use HTTP or HTTPS",
  ),
  credentialSource: z.enum(["environment", "independent"]),
  credentialRef: z.string().regex(HEX_MD5).nullable(),
  status: modelSiteStatusSchema,
  lastValidatedAt: z.string().datetime({ offset: true }).nullable(),
}).strict().superRefine((value, context) => {
  if (value.adapter === "codex_environment" && value.baseUrl !== null) {
    context.addIssue({ code: "custom", path: ["baseUrl"], message: "Codex environment sites cannot set a base URL" });
  }
  if (value.adapter === "codex_environment" && value.credentialSource !== "environment") {
    context.addIssue({ code: "custom", path: ["credentialSource"], message: "Codex environment sites must use environment credentials" });
  }
  if (value.adapter !== "codex_environment" && value.baseUrl === null) {
    context.addIssue({ code: "custom", path: ["baseUrl"], message: "Model sites require a base URL" });
  }
  if (value.credentialSource === "independent" && value.credentialRef === null) {
    context.addIssue({ code: "custom", path: ["credentialRef"], message: "Independent model sites require a credential reference" });
  }
});
export type ModelSite = z.infer<typeof modelSiteSchema>;

export const modelCatalogEntrySchema = z.object({
  modelKey: z.string().regex(HEX_MD5),
  name: z.string().trim().min(1).max(512).refine((value) => !CONTROL_CHARACTERS.test(value)),
  label: z.string().trim().min(1).max(256).refine((value) => !CONTROL_CHARACTERS.test(value)),
  manual: z.boolean().default(false),
}).strict();
export type ModelCatalogEntry = z.infer<typeof modelCatalogEntrySchema>;

export const modelCatalogSiteSchema = z.object({
  refreshedAt: z.string().datetime({ offset: true }),
  models: z.array(modelCatalogEntrySchema).max(10_000),
}).strict();
export type ModelCatalogSite = z.infer<typeof modelCatalogSiteSchema>;

export const modelCatalogSchema = z.object({
  schemaVersion: z.literal(localModelCatalogSchemaVersion),
  sites: z.record(z.string().regex(HEX_MD5), modelCatalogSiteSchema),
}).strict();
export type ModelCatalog = z.infer<typeof modelCatalogSchema>;

export const loopModelRoutingSchema = z.object({
  schemaVersion: z.literal(localModelSelectionSchemaVersion),
  loops: z.record(z.string().trim().min(1).max(128).regex(SAFE_LOCAL_ID), z.object({
    default: modelSelectionSchema.nullable().optional(),
    nodes: z.record(z.string().trim().min(1).max(128).regex(SAFE_LOCAL_ID), modelSelectionSchema),
  }).strict()),
}).strict();
export type LoopModelRouting = z.infer<typeof loopModelRoutingSchema>;

export const modelSitesDocumentSchema = z.object({
  schemaVersion: z.literal(localModelSelectionSchemaVersion),
  sites: z.array(modelSiteSchema).max(256),
  accountDefault: modelSelectionSchema.nullable().optional(),
}).strict();
export type ModelSitesDocument = z.infer<typeof modelSitesDocumentSchema>;

export const agentCredentialStatusSchema = z.object({
  credentialRef: z.string().regex(HEX_MD5),
  kind: z.literal("openai_api_key"),
  configured: z.boolean(),
  updatedAt: z.string().datetime({ offset: true }).nullable(),
}).strict();
export type AgentCredentialStatus = z.infer<typeof agentCredentialStatusSchema>;

type Md5Word = number;

function leftRotate(value: Md5Word, amount: number): Md5Word {
  return ((value << amount) | (value >>> (32 - amount))) >>> 0;
}

/** Browser-compatible MD5 used only for opaque local identifiers, never for secrets. */
export function computeLocalMd5(value: string): string {
  const source = new TextEncoder().encode(value);
  const bitLength = source.length * 8;
  const paddedLength = (((source.length + 8) >>> 6) + 1) * 64;
  const bytes = new Uint8Array(paddedLength);
  bytes.set(source);
  bytes[source.length] = 0x80;
  const view = new DataView(bytes.buffer);
  view.setUint32(paddedLength - 8, bitLength >>> 0, true);
  view.setUint32(paddedLength - 4, Math.floor(bitLength / 0x1_0000_0000), true);

  const shifts = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const constants = Array.from({ length: 64 }, (_, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 0x1_0000_0000) >>> 0);
  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let offset = 0; offset < bytes.length; offset += 64) {
    const words = new Uint32Array(16);
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4, true);
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let index = 0; index < 64; index += 1) {
      let functionValue: number;
      let wordIndex: number;
      if (index < 16) {
        functionValue = (b & c) | (~b & d);
        wordIndex = index;
      } else if (index < 32) {
        functionValue = (d & b) | (~d & c);
        wordIndex = (5 * index + 1) % 16;
      } else if (index < 48) {
        functionValue = b ^ c ^ d;
        wordIndex = (3 * index + 5) % 16;
      } else {
        functionValue = c ^ (b | ~d);
        wordIndex = (7 * index) % 16;
      }
      const next = (a + functionValue + constants[index]! + words[wordIndex]!) >>> 0;
      const rotated = leftRotate(next, shifts[index]!);
      const nextA = d;
      d = c;
      c = b;
      b = (b + rotated) >>> 0;
      a = nextA;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  const output = new Uint8Array(16);
  const outputView = new DataView(output.buffer);
  outputView.setUint32(0, a0, true);
  outputView.setUint32(4, b0, true);
  outputView.setUint32(8, c0, true);
  outputView.setUint32(12, d0, true);
  return [...output].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Stable local reference for the account's default Codex credential. */
export const DEFAULT_CODEX_CREDENTIAL_REF = computeLocalMd5("humanthread:codex:default-openai-api-key");

function normalizeDeploymentOrigin(origin: string): string {
  const value = origin.trim();
  if (CONTROL_CHARACTERS.test(value)) throw new Error("Deployment origin is invalid");
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Deployment origin must use HTTP or HTTPS");
  parsed.hash = "";
  parsed.search = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/u, "");
  return parsed.toString().replace(/\/$/u, "").toLowerCase();
}

export async function computeAccountScopeHash(deploymentOrigin: string, userId: string): Promise<string> {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId || CONTROL_CHARACTERS.test(normalizedUserId)) throw new Error("User ID is invalid");
  const bytes = new TextEncoder().encode(`${normalizeDeploymentOrigin(deploymentOrigin)}\0${normalizedUserId}`);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type LocalModelResolution =
  | { source: "provider"; reasoningEffort?: ReasoningEffort }
  | {
    source: "node" | "loop" | "account";
    site: ModelSite;
    model: ModelCatalogEntry;
    reasoningEffort: ReasoningEffort;
  };

export type LocalModelResolutionInput = {
  loopDefinitionId: string;
  nodeId: string;
  sites: ModelSite[];
  catalog: ModelCatalog;
  routing?: LoopModelRouting | undefined;
  accountDefault?: ModelSelection | null | undefined;
};

function resolveSelection(
  source: Exclude<LocalModelResolution["source"], "provider">,
  selection: ModelSelection,
  sites: ModelSite[],
  catalog: ModelCatalog,
): LocalModelResolution {
  const site = sites.find((candidate) => candidate.siteId === selection.siteId);
  if (!site) throw new Error(`${source} configured model site is unavailable`);
  const models = catalog.sites[site.siteId]?.models;
  const model = models?.find((candidate) => candidate.modelKey === selection.modelKey);
  if (!model) throw new Error(`${source} configured model is unavailable`);
  if (site.credentialSource === "independent" && !site.credentialRef) {
    throw new Error(`${source} configured model credential is unavailable`);
  }
  return { source, site, model, reasoningEffort: selection.reasoningEffort };
}

export function resolveLocalModel(input: LocalModelResolutionInput): LocalModelResolution {
  const loop = input.routing?.loops[input.loopDefinitionId];
  const candidates: Array<[
    Exclude<LocalModelResolution["source"], "provider">,
    ModelSelection | undefined,
  ]> = [
    ["node", loop?.nodes[input.nodeId]],
    ["loop", loop?.default ?? undefined],
    ["account", input.accountDefault ?? undefined],
  ];
  for (const [source, selection] of candidates) {
    if (selection !== undefined) return resolveSelection(source, selection, input.sites, input.catalog);
  }
  return { source: "provider" };
}
