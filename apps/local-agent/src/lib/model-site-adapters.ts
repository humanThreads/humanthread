import {
  computeLocalMd5,
  modelCatalogEntrySchema,
  modelCatalogSiteSchema,
  type ModelCatalogEntry,
  type ModelCatalogSite,
  type ModelSite,
} from "./local-model-configuration";

const MAX_DISCOVERY_BYTES = 2_000_000;
const DISCOVERY_TIMEOUT_MS = 10_000;

export type ModelSiteFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export type ModelDiscoveryDependencies = {
  fetch: ModelSiteFetch;
  credential?: string;
  timeoutMs?: number;
};

function discoveryError(message: string): Error {
  return Object.assign(new Error(message), { code: "model_discovery_failed" });
}

function discoveryUrl(site: ModelSite): string {
  if (!site.baseUrl) throw discoveryError("Model site discovery requires a base URL");
  const base = site.baseUrl.replace(/\/+$/u, "");
  if (site.adapter === "ollama") return base + "/api/tags";
  if (site.adapter === "openai_compatible" || site.adapter === "lmstudio") return base + "/models";
  throw discoveryError("Codex environment model discovery is not supported");
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_DISCOVERY_BYTES) {
    throw discoveryError("Model catalog response is too large");
  }
  let bytes: ArrayBuffer;
  if (typeof response.arrayBuffer === "function") {
    bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_DISCOVERY_BYTES) throw discoveryError("Model catalog response is too large");
    try {
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw discoveryError("Model catalog response is invalid");
    }
  }
  const text = await response.text();
  if (text.length > MAX_DISCOVERY_BYTES) throw discoveryError("Model catalog response is too large");
  try {
    return JSON.parse(text);
  } catch {
    throw discoveryError("Model catalog response is invalid");
  }
}

function modelName(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const candidate = typeof record.id === "string"
    ? record.id
    : typeof record.name === "string"
      ? record.name
      : typeof record.model === "string"
        ? record.model
        : null;
  if (!candidate || !candidate.trim() || candidate.length > 512 || /[\u0000-\u001F\u007F]/u.test(candidate)) return null;
  return candidate.trim();
}

function modelLabel(value: unknown, fallback: string): string {
  if (!value || typeof value !== "object") return fallback;
  const label = (value as Record<string, unknown>).name;
  return typeof label === "string" && label.trim() && label.length <= 256 ? label.trim() : fallback;
}

function extractModels(site: ModelSite, value: unknown): Array<{ name: string; label: string }> {
  if (!value || typeof value !== "object") throw discoveryError("Model catalog response is invalid");
  const record = value as Record<string, unknown>;
  const collection = site.adapter === "ollama" ? record.models : record.data;
  if (!Array.isArray(collection)) throw discoveryError("Model catalog response is invalid");
  const models: Array<{ name: string; label: string }> = [];
  const seen = new Set<string>();
  for (const item of collection) {
    const name = modelName(item);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    models.push({ name, label: modelLabel(item, name) });
  }
  return models;
}

export function manualModelEntry(site: ModelSite, name: string): ModelCatalogEntry {
  const normalized = name.trim();
  if (!normalized || normalized.length > 512 || /[\u0000-\u001F\u007F]/u.test(normalized)) {
    throw discoveryError("Manual model name is invalid");
  }
  return modelCatalogEntrySchema.parse({
    modelKey: computeLocalMd5(site.siteId + "\0" + normalized),
    name: normalized,
    label: normalized,
    manual: true,
  });
}

export function normalizeModelCatalog(
  site: ModelSite,
  models: Array<ModelCatalogEntry | { name: string; label?: string; manual?: boolean }>,
  refreshedAt = new Date().toISOString(),
): ModelCatalogSite {
  const entries: ModelCatalogEntry[] = [];
  const seen = new Set<string>();
  for (const value of models) {
    const name = value.name.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    entries.push(modelCatalogEntrySchema.parse({
      modelKey: computeLocalModelKey(site, name),
      name,
      label: value.label?.trim() || name,
      manual: value.manual ?? false,
    }));
  }
  return modelCatalogSiteSchema.parse({ refreshedAt, models: entries });
}

function computeLocalModelKey(site: ModelSite, name: string): string {
  return computeLocalMd5(site.siteId + "\0" + name);
}

export async function discoverModelCatalog(
  site: ModelSite,
  dependencies: ModelDiscoveryDependencies,
): Promise<ModelCatalogSite> {
  if (site.adapter === "codex_environment") {
    throw discoveryError("Codex environment model discovery is not supported");
  }
  if (site.credentialSource === "independent" && !dependencies.credential?.trim()) {
    throw Object.assign(new Error("Model site credential is unavailable"), { code: "model_credential_unavailable" });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), dependencies.timeoutMs ?? DISCOVERY_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { accept: "application/json" };
    if (dependencies.credential?.trim()) headers.authorization = "Bearer " + dependencies.credential.trim();
    const response = await dependencies.fetch(discoveryUrl(site), {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    if (!response.ok) throw discoveryError("Model site returned HTTP " + response.status);
    const payload = await readBoundedJson(response);
    return normalizeModelCatalog(site, extractModels(site, payload).map((model) => ({
      name: model.name,
      label: model.label,
      manual: false,
    })));
  } catch (error) {
    if (controller.signal.aborted) throw discoveryError("Model site discovery timed out");
    if (error instanceof Error && error.message.includes("Model catalog")) throw error;
    if (error instanceof Error && error.message.includes("Model site returned")) throw error;
    throw discoveryError("Model site discovery failed");
  } finally {
    clearTimeout(timeout);
  }
}
