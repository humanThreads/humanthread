import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

export const CREDENTIAL_SCHEMA_VERSION = 1;
export const MODEL_CATALOG_SCHEMA_VERSION = 1;
export const MODEL_SELECTION_SCHEMA_VERSION = 2;
export const LEGACY_MODEL_SELECTION_SCHEMA_VERSION = 1;
export const DEFAULT_REASONING_EFFORT = "high";
const MAX_JSON_BYTES = 8 * 1024 * 1024;
const HEX_DIGEST_LENGTH = 32;

export interface CredentialContext {
  deploymentOrigin: string;
  userId: string;
  credentialRef: string;
}

export interface IsolationContext {
  deploymentOrigin: string;
  userId: string;
}

export interface AgentCredentialStatus {
  credentialRef: string;
  kind: string;
  configured: boolean;
  updatedAt: string | null;
}

interface CredentialRecord {
  kind: string;
  apiKey: string;
  updatedAt: string;
}

interface CredentialsDocument {
  schemaVersion: number;
  credentials: Record<string, CredentialRecord>;
}

export interface ModelSelection {
  siteId: string;
  modelKey: string;
  reasoningEffort: string;
}

export interface ModelSite {
  siteId: string;
  name: string;
  adapter: string;
  baseUrl: string | null;
  credentialSource: string;
  credentialRef: string | null;
  status: string;
  lastValidatedAt: string | null;
}

export interface ModelSitesDocument {
  schemaVersion: number;
  sites: ModelSite[];
  accountDefault: ModelSelection | null;
}

export interface ModelCatalogEntry {
  modelKey: string;
  name: string;
  label: string;
  manual: boolean;
}

export interface ModelCatalogSite {
  refreshedAt: string;
  models: ModelCatalogEntry[];
}

export interface ModelCatalogDocument {
  schemaVersion: number;
  sites: Record<string, ModelCatalogSite>;
}

export interface LoopModelRoutingEntry {
  default: ModelSelection | null;
  nodes: Record<string, ModelSelection>;
}

export interface LoopModelRoutingDocument {
  schemaVersion: number;
  loops: Record<string, LoopModelRoutingEntry>;
}

export type LocalModelFetch = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

function invalid(message: string): Error {
  return new Error(message);
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && Reflect.get(error, "code") === "ENOENT";
}

export function validHexDigest(value: string): boolean {
  return value.length === HEX_DIGEST_LENGTH && /^[0-9a-f]+$/u.test(value);
}

function validLocalName(value: string, maximum: number): boolean {
  return value.length > 0 && value.length <= maximum && !/[\u0000-\u001F\u007F]/u.test(value);
}

function normalizeCredential(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 4_096 || /[\u0000-\u001F\u007F]/u.test(trimmed)) {
    throw invalid("Credential input is invalid");
  }
  return trimmed;
}

function validateSelection(value: ModelSelection): void {
  if (!validHexDigest(value.siteId) || !validHexDigest(value.modelKey)) {
    throw invalid("Local model selection is invalid");
  }
  if (!["low", "medium", "high", "xhigh", "max", "ultra"].includes(value.reasoningEffort)) {
    throw invalid("Local model reasoning effort is invalid");
  }
}

function validateSite(value: ModelSite): void {
  if (
    !validHexDigest(value.siteId) ||
    !validLocalName(value.name, 128) ||
    !["codex_environment", "openai_compatible", "ollama", "lmstudio"].includes(value.adapter) ||
    !["environment", "independent"].includes(value.credentialSource) ||
    !["ready", "needs_revalidation", "connection_failed", "untested"].includes(value.status)
  ) {
    throw invalid("Local model site is invalid");
  }
  if (value.adapter === "codex_environment") {
    if (value.baseUrl !== null) {
      throw invalid("Codex environment sites cannot set a base URL");
    }
    if (value.credentialSource !== "environment") {
      throw invalid("Codex environment sites must use environment credentials");
    }
  } else if (
    value.baseUrl === null ||
    value.baseUrl.length > 2_048 ||
    /[\u0000-\u001F\u007F]/u.test(value.baseUrl) ||
    (!value.baseUrl.startsWith("http://") && !value.baseUrl.startsWith("https://"))
  ) {
    throw invalid("Model site base URL is invalid");
  }
  if (value.credentialSource === "independent") {
    if (value.credentialRef === null || !validHexDigest(value.credentialRef)) {
      throw invalid("Independent model site credential reference is invalid");
    }
  } else if (value.credentialRef !== null) {
    throw invalid("Environment model sites cannot set a credential reference");
  }
}

function validateSitesDocument(value: ModelSitesDocument): void {
  if (value.schemaVersion !== MODEL_SELECTION_SCHEMA_VERSION || value.sites.length > 256) {
    throw invalid("Local model sites configuration is corrupted");
  }
  const ids = new Set<string>();
  for (const site of value.sites) {
    validateSite(site);
    if (ids.has(site.siteId)) {
      throw invalid("Local model site identifiers must be unique");
    }
    ids.add(site.siteId);
  }
  if (value.accountDefault !== null) {
    validateSelection(value.accountDefault);
  }
}

function validateAccountDefault(
  selection: ModelSelection | null,
  sites: ModelSitesDocument,
  catalog: ModelCatalogDocument,
): void {
  if (selection === null) return;
  validateSelection(selection);
  if (!sites.sites.some((site) => site.siteId === selection.siteId)) {
    throw invalid("Account default model site is unavailable");
  }
  const siteCatalog = catalog.sites[selection.siteId];
  if (siteCatalog === undefined) {
    throw invalid("Account default model catalog is unavailable");
  }
  if (!siteCatalog.models.some((model) => model.modelKey === selection.modelKey)) {
    throw invalid("Account default model is unavailable");
  }
}

function validateCatalogDocument(value: ModelCatalogDocument): void {
  if (value.schemaVersion !== MODEL_CATALOG_SCHEMA_VERSION || Object.keys(value.sites).length > 256) {
    throw invalid("Local model catalog is corrupted");
  }
  for (const [siteId, catalog] of Object.entries(value.sites)) {
    if (!validHexDigest(siteId) || catalog.models.length > 10_000 || catalog.refreshedAt.length === 0) {
      throw invalid("Local model catalog is corrupted");
    }
    const keys = new Set<string>();
    for (const model of catalog.models) {
      if (
        !validHexDigest(model.modelKey) ||
        !validLocalName(model.name, 512) ||
        !validLocalName(model.label, 256) ||
        keys.has(model.modelKey)
      ) {
        throw invalid("Local model catalog is corrupted");
      }
      keys.add(model.modelKey);
    }
  }
}

function validateRoutingDocument(value: LoopModelRoutingDocument): void {
  if (value.schemaVersion !== MODEL_SELECTION_SCHEMA_VERSION || Object.keys(value.loops).length > 10_000) {
    throw invalid("Local Loop model routing is corrupted");
  }
  for (const [loopId, entry] of Object.entries(value.loops)) {
    if (!validLocalName(loopId, 128) || Object.keys(entry.nodes).length > 10_000) {
      throw invalid("Local Loop model routing is corrupted");
    }
    if (entry.default !== null) {
      validateSelection(entry.default);
    }
    for (const [nodeId, selection] of Object.entries(entry.nodes)) {
      if (!validLocalName(nodeId, 128)) {
        throw invalid("Local Loop model routing is corrupted");
      }
      validateSelection(selection);
    }
  }
}

export function normalizeDeploymentOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw invalid("Deployment origin is invalid");
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0 ||
    (parsed.pathname !== "" && parsed.pathname !== "/")
  ) {
    throw invalid("Deployment origin is invalid");
  }
  const port = parsed.port.length > 0 ? `:${parsed.port}` : "";
  return `${parsed.protocol.slice(0, -1).toLowerCase()}://${parsed.hostname.toLowerCase()}${port}`;
}

export function accountDirectory(deploymentOrigin: string, userId: string): string {
  const origin = normalizeDeploymentOrigin(deploymentOrigin);
  const user = userId.trim();
  if (user.length === 0 || user.length > 256 || /[\u0000-\u001F\u007F]/u.test(user)) {
    throw invalid("User ID is invalid");
  }
  const scope = createHash("sha256").update(origin).update("\0").update(user).digest("hex");
  const home = process.env.HOME ?? process.env.USERPROFILE ?? homedir();
  if (!home) {
    throw invalid("User home directory is unavailable");
  }
  return join(home, ".humanthread", "accounts", scope);
}

function sourceCodexConfigPath(): string {
  const home = process.env.CODEX_HOME ?? process.env.HOME ?? process.env.USERPROFILE ?? homedir();
  if (!home) throw invalid("User home directory is unavailable");
  return process.env.CODEX_HOME
    ? join(home, "config.toml")
    : join(home, ".codex", "config.toml");
}

function projectIsolatedCodexConfig(source: string | null): string {
  const projected: Record<string, unknown> = {};
  if (source !== null) {
    let parsed: Record<string, unknown>;
    try {
      parsed = parseToml(source.trimStart()) as Record<string, unknown>;
    } catch {
      throw invalid("Codex configuration is invalid");
    }
    if (parsed.mcp_servers !== undefined) {
      projected.mcp_servers = parsed.mcp_servers;
    }
  }
  if (Object.keys(projected).length === 0) return "";
  return `${stringifyToml(projected).trimEnd()}\n`;
}

function rejectSymlink(path: string): void {
  let metadata;
  try {
    metadata = lstatSync(path);
  } catch (error) {
    if (isNotFound(error)) return;
    throw new Error(`Failed to inspect local configuration: ${(error as Error).message}`);
  }
  if (metadata.isSymbolicLink()) {
    throw invalid("Symlinks are forbidden in local configuration");
  }
}

function restrictDirectory(path: string): void {
  if (process.platform === "win32") return;
  try {
    chmodSync(path, 0o700);
  } catch {
    throw new Error("Failed to secure local configuration directory");
  }
}

function restrictFile(path: string): void {
  if (process.platform === "win32") return;
  try {
    chmodSync(path, 0o600);
  } catch {
    throw new Error("Failed to secure local configuration file");
  }
}

function atomicWriteText(path: string, content: string): void {
  rejectSymlink(path);
  const parent = dirname(path);
  if (parent === path) throw invalid("Local configuration file has no parent");
  const temporary = join(parent, `.config.toml.${process.hrtime.bigint()}.tmp`);
  let descriptor: number;
  try {
    descriptor = openSync(temporary, "wx");
  } catch (error) {
    throw new Error(`Failed to create isolated Codex configuration: ${(error as Error).message}`);
  }
  restrictFile(temporary);
  try {
    writeSync(descriptor, content);
    fsyncSync(descriptor);
  } catch (error) {
    closeSync(descriptor);
    rmSync(temporary, { force: true });
    throw new Error(`Failed to write isolated Codex configuration: ${(error as Error).message}`);
  }
  closeSync(descriptor);
  try {
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw new Error(`Failed to replace isolated Codex configuration: ${(error as Error).message}`);
  }
  restrictFile(path);
}

export function prepareIsolatedCodexHome(deploymentOrigin: string, userId: string): string {
  const account = accountDirectory(deploymentOrigin, userId);
  prepareAccountDirectory(account);
  const codexHome = join(account, "codex-home");
  rejectSymlink(codexHome);
  try {
    mkdirSync(codexHome, { recursive: true });
  } catch (error) {
    throw new Error(`Failed to create isolated Codex home: ${(error as Error).message}`);
  }
  restrictDirectory(codexHome);

  const sourcePath = sourceCodexConfigPath();
  let source: string | null = null;
  try {
    const metadata = statSync(sourcePath);
    if (metadata.size > MAX_JSON_BYTES) {
      throw invalid("Codex configuration is too large");
    }
    source = readFileSync(sourcePath, "utf8");
  } catch (error) {
    if (!isNotFound(error)) {
      if (error instanceof Error && error.message === "Codex configuration is too large") throw error;
      throw new Error(`Failed to inspect Codex configuration: ${(error as Error).message}`);
    }
  }
  const projected = projectIsolatedCodexConfig(source);
  atomicWriteText(join(codexHome, "config.toml"), projected);
  return codexHome;
}

export function writeIsolatedChecklistMcpConfig(
  codexHome: string,
  url: string,
  headers: Record<string, string>,
): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw invalid("Checklist MCP URL is invalid");
  }
  const headerEntries = Object.entries(headers);
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0 ||
    headerEntries.length === 0 ||
    headerEntries.length > 8 ||
    headerEntries.some(([name, value]) =>
      name.length === 0 ||
      name.length > 128 ||
      !/^[A-Za-z0-9-]+$/u.test(name) ||
      value.length === 0 ||
      value.length > 4_096 ||
      /[\u0000-\u001F\u007F]/u.test(value),
    )
  ) {
    throw invalid("Checklist MCP configuration is invalid");
  }
  const content = stringifyToml({
    mcp_servers: {
      humanthread_checklist: {
        url: parsed.toString(),
        http_headers: headers,
      },
    },
  });
  atomicWriteText(join(codexHome, "config.toml"), `${content.trimEnd()}\n`);
}

function prepareAccountDirectory(directory: string): void {
  const accountRoot = dirname(directory);
  const root = dirname(accountRoot);
  if (root === accountRoot || accountRoot === directory) {
    throw invalid("Local configuration path is invalid");
  }
  for (const path of [root, accountRoot, directory]) {
    rejectSymlink(path);
    try {
      mkdirSync(path, { recursive: true });
    } catch (error) {
      throw new Error(`Failed to create local configuration directory: ${(error as Error).message}`);
    }
    restrictDirectory(path);
  }
}

function documentPath(directory: string, name: string): string {
  if (!["credentials.json", "model-sites.json", "model-catalog.json", "loop-model-routing.json"].includes(name)) {
    throw invalid("Local configuration filename is invalid");
  }
  const path = join(directory, name);
  rejectSymlink(path);
  return path;
}

function readJsonContent(path: string): string | null {
  rejectSymlink(path);
  let metadata;
  try {
    metadata = statSync(path);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw new Error(`Failed to inspect local configuration: ${(error as Error).message}`);
  }
  if (metadata.size > MAX_JSON_BYTES) {
    throw invalid("Local configuration file is too large");
  }
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`Failed to read local configuration: ${(error as Error).message}`);
  }
}

function atomicWriteJson(path: string, value: unknown): void {
  rejectSymlink(path);
  const parent = dirname(path);
  if (parent === path) throw invalid("Local configuration file has no parent");
  rejectSymlink(parent);
  const content = JSON.stringify(value, null, 2);
  const temporary = join(parent, `.${basename(path)}.${process.hrtime.bigint()}.tmp`);
  let descriptor: number;
  try {
    descriptor = openSync(temporary, "wx");
  } catch (error) {
    throw new Error(`Failed to create local configuration temporary file: ${(error as Error).message}`);
  }
  restrictFile(temporary);
  try {
    writeSync(descriptor, content);
    fsyncSync(descriptor);
  } catch (error) {
    closeSync(descriptor);
    rmSync(temporary, { force: true });
    throw new Error(`Failed to write local configuration: ${(error as Error).message}`);
  }
  closeSync(descriptor);
  try {
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw new Error(`Failed to replace local configuration: ${(error as Error).message}`);
  }
  restrictFile(path);
}

function emptySites(): ModelSitesDocument {
  return { schemaVersion: MODEL_SELECTION_SCHEMA_VERSION, sites: [], accountDefault: null };
}

function emptyCatalog(): ModelCatalogDocument {
  return { schemaVersion: MODEL_CATALOG_SCHEMA_VERSION, sites: {} };
}

function emptyRouting(): LoopModelRoutingDocument {
  return { schemaVersion: MODEL_SELECTION_SCHEMA_VERSION, loops: {} };
}

function emptyCredentials(): CredentialsDocument {
  return { schemaVersion: CREDENTIAL_SCHEMA_VERSION, credentials: {} };
}

function readJson<T>(path: string, fallback: T): T {
  const content = readJsonContent(path);
  if (content === null) return fallback;
  try {
    return JSON.parse(content) as T;
  } catch {
    throw invalid("Local configuration file is corrupted");
  }
}

interface SchemaVersionDocument {
  schemaVersion?: unknown;
}

function readSchemaVersion(content: string): number {
  let parsed: SchemaVersionDocument;
  try {
    parsed = JSON.parse(content) as SchemaVersionDocument;
  } catch {
    throw invalid("Local model configuration is invalid");
  }
  if (typeof parsed.schemaVersion !== "number") {
    throw invalid("Local model configuration is invalid");
  }
  return parsed.schemaVersion;
}

function migrateSelection(value: { siteId?: unknown; modelKey?: unknown }, reasoningEffort: string): ModelSelection {
  if (typeof value.siteId !== "string" || typeof value.modelKey !== "string") {
    throw invalid("Local model configuration is invalid");
  }
  return { siteId: value.siteId, modelKey: value.modelKey, reasoningEffort };
}

function migrateSitesDocument(value: { sites?: unknown; accountDefault?: unknown }): ModelSitesDocument {
  const accountDefault = value.accountDefault;
  return {
    schemaVersion: MODEL_SELECTION_SCHEMA_VERSION,
    sites: Array.isArray(value.sites) ? (value.sites as ModelSite[]) : [],
    accountDefault: accountDefault && typeof accountDefault === "object"
      ? migrateSelection(accountDefault as { siteId?: unknown; modelKey?: unknown }, DEFAULT_REASONING_EFFORT)
      : null,
  };
}

function migrateRoutingDocument(value: { loops?: unknown }): LoopModelRoutingDocument {
  const loops: Record<string, LoopModelRoutingEntry> = {};
  if (value.loops && typeof value.loops === "object") {
    for (const [loopId, rawEntry] of Object.entries(value.loops as Record<string, unknown>)) {
      const entry = rawEntry && typeof rawEntry === "object" ? (rawEntry as Record<string, unknown>) : {};
      const defaultSelection = entry.default;
      const nodes: Record<string, ModelSelection> = {};
      if (entry.nodes && typeof entry.nodes === "object") {
        for (const [nodeId, rawSelection] of Object.entries(entry.nodes as Record<string, unknown>)) {
          nodes[nodeId] = migrateSelection(
            (rawSelection ?? {}) as { siteId?: unknown; modelKey?: unknown },
            DEFAULT_REASONING_EFFORT,
          );
        }
      }
      loops[loopId] = {
        default: defaultSelection && typeof defaultSelection === "object"
          ? migrateSelection(defaultSelection as { siteId?: unknown; modelKey?: unknown }, DEFAULT_REASONING_EFFORT)
          : null,
        nodes,
      };
    }
  }
  return { schemaVersion: MODEL_SELECTION_SCHEMA_VERSION, loops };
}

function readModelSitesDocument(path: string): ModelSitesDocument {
  const content = readJsonContent(path);
  if (content === null) return emptySites();
  const schemaVersion = readSchemaVersion(content);
  if (schemaVersion === MODEL_SELECTION_SCHEMA_VERSION) {
    const document = JSON.parse(content) as ModelSitesDocument;
    validateSitesDocument(document);
    return document;
  }
  if (schemaVersion === LEGACY_MODEL_SELECTION_SCHEMA_VERSION) {
    const document = migrateSitesDocument(JSON.parse(content) as { sites?: unknown; accountDefault?: unknown });
    validateSitesDocument(document);
    atomicWriteJson(path, document);
    return document;
  }
  throw invalid("Local model configuration version is unsupported");
}

function readCatalogDocument(path: string): ModelCatalogDocument {
  const document = readJson(path, emptyCatalog());
  validateCatalogDocument(document);
  return document;
}

function readRoutingDocument(path: string): LoopModelRoutingDocument {
  const content = readJsonContent(path);
  if (content === null) return emptyRouting();
  const schemaVersion = readSchemaVersion(content);
  if (schemaVersion === MODEL_SELECTION_SCHEMA_VERSION) {
    const document = JSON.parse(content) as LoopModelRoutingDocument;
    validateRoutingDocument(document);
    return document;
  }
  if (schemaVersion === LEGACY_MODEL_SELECTION_SCHEMA_VERSION) {
    const document = migrateRoutingDocument(JSON.parse(content) as { loops?: unknown });
    validateRoutingDocument(document);
    atomicWriteJson(path, document);
    return document;
  }
  throw invalid("Local model configuration version is unsupported");
}

function accountDocumentPath(deploymentOrigin: string, userId: string, name: string): string {
  const directory = accountDirectory(deploymentOrigin, userId);
  prepareAccountDirectory(directory);
  return documentPath(directory, name);
}

function nowIso8601(): string {
  return new Date().toISOString();
}

export function getAgentCredentialStatus(input: {
  deploymentOrigin: string;
  userId: string;
  credentialRef: string;
}): AgentCredentialStatus {
  if (!validHexDigest(input.credentialRef)) {
    throw invalid("Credential reference is invalid");
  }
  const path = accountDocumentPath(input.deploymentOrigin, input.userId, "credentials.json");
  const document = readJson(path, emptyCredentials());
  if (document.schemaVersion !== CREDENTIAL_SCHEMA_VERSION) {
    throw invalid("Credential configuration is corrupted");
  }
  const record = document.credentials[input.credentialRef];
  return {
    credentialRef: input.credentialRef,
    kind: "openai_api_key",
    configured: record !== undefined && record.kind === "openai_api_key" && record.apiKey.length > 0,
    updatedAt: record?.updatedAt ?? null,
  };
}

export function setAgentCredential(input: {
  deploymentOrigin: string;
  userId: string;
  credentialRef: string;
  kind: string;
  apiKey: string;
}): AgentCredentialStatus {
  if (!validHexDigest(input.credentialRef) || input.kind !== "openai_api_key") {
    throw invalid("Credential input is invalid");
  }
  const key = normalizeCredential(input.apiKey);
  const path = accountDocumentPath(input.deploymentOrigin, input.userId, "credentials.json");
  const document = readJson(path, emptyCredentials());
  if (document.schemaVersion !== CREDENTIAL_SCHEMA_VERSION) {
    throw invalid("Credential configuration is corrupted");
  }
  const updatedAt = nowIso8601();
  document.credentials[input.credentialRef] = { kind: input.kind, apiKey: key, updatedAt };
  atomicWriteJson(path, document);
  return { credentialRef: input.credentialRef, kind: input.kind, configured: true, updatedAt };
}

export function deleteAgentCredential(input: {
  deploymentOrigin: string;
  userId: string;
  credentialRef: string;
}): AgentCredentialStatus {
  if (!validHexDigest(input.credentialRef)) {
    throw invalid("Credential reference is invalid");
  }
  const path = accountDocumentPath(input.deploymentOrigin, input.userId, "credentials.json");
  const document = readJson(path, emptyCredentials());
  if (document.schemaVersion !== CREDENTIAL_SCHEMA_VERSION) {
    throw invalid("Credential configuration is corrupted");
  }
  delete document.credentials[input.credentialRef];
  if (Object.keys(document.credentials).length === 0) {
    rejectSymlink(path);
    rmSync(path, { force: true });
  } else {
    atomicWriteJson(path, document);
  }
  return {
    credentialRef: input.credentialRef,
    kind: "openai_api_key",
    configured: false,
    updatedAt: null,
  };
}

export function readAgentCredential(deploymentOrigin: string, userId: string, credentialRef: string): string {
  if (!validHexDigest(credentialRef)) {
    throw invalid("Credential reference is invalid");
  }
  const path = accountDocumentPath(deploymentOrigin, userId, "credentials.json");
  const document = readJson(path, emptyCredentials());
  if (document.schemaVersion !== CREDENTIAL_SCHEMA_VERSION) {
    throw invalid("Credential configuration is corrupted");
  }
  const record = document.credentials[credentialRef];
  if (record === undefined) {
    throw invalid("Local credential is not configured");
  }
  if (record.kind !== "openai_api_key" || record.apiKey.length === 0) {
    throw invalid("Local credential is invalid");
  }
  return record.apiKey;
}

export function listModelSites(input: { deploymentOrigin: string; userId: string }): ModelSitesDocument {
  const path = accountDocumentPath(input.deploymentOrigin, input.userId, "model-sites.json");
  return readModelSitesDocument(path);
}

export function saveModelSite(input: {
  deploymentOrigin: string;
  userId: string;
  site: ModelSite;
  accountDefault: ModelSelection | null;
}): ModelSitesDocument {
  validateSite(input.site);
  const path = accountDocumentPath(input.deploymentOrigin, input.userId, "model-sites.json");
  const catalog = getModelCatalog({ deploymentOrigin: input.deploymentOrigin, userId: input.userId });
  const document = readModelSitesDocument(path);
  const existingIndex = document.sites.findIndex((value) => value.siteId === input.site.siteId);
  if (existingIndex >= 0) {
    document.sites[existingIndex] = input.site;
  } else {
    document.sites.push(input.site);
  }
  validateAccountDefault(input.accountDefault, document, catalog);
  document.accountDefault = input.accountDefault;
  validateSitesDocument(document);
  atomicWriteJson(path, document);
  return document;
}

export function saveModelDefaults(input: {
  deploymentOrigin: string;
  userId: string;
  accountDefault: ModelSelection | null;
}): ModelSitesDocument {
  const path = accountDocumentPath(input.deploymentOrigin, input.userId, "model-sites.json");
  const catalog = getModelCatalog({ deploymentOrigin: input.deploymentOrigin, userId: input.userId });
  const document = readModelSitesDocument(path);
  validateAccountDefault(input.accountDefault, document, catalog);
  document.accountDefault = input.accountDefault;
  validateSitesDocument(document);
  atomicWriteJson(path, document);
  return document;
}

function siteIsReferenced(
  siteId: string,
  sites: ModelSitesDocument,
  routing: LoopModelRoutingDocument,
): boolean {
  return (
    sites.accountDefault?.siteId === siteId ||
    Object.values(routing.loops).some(
      (entry) =>
        entry.default?.siteId === siteId ||
        Object.values(entry.nodes).some((selection) => selection.siteId === siteId),
    )
  );
}

export function deleteModelSite(input: {
  deploymentOrigin: string;
  userId: string;
  siteId: string;
}): ModelSitesDocument {
  if (!validHexDigest(input.siteId)) {
    throw invalid("Model site identifier is invalid");
  }
  const sitesPath = accountDocumentPath(input.deploymentOrigin, input.userId, "model-sites.json");
  const routingPath = accountDocumentPath(input.deploymentOrigin, input.userId, "loop-model-routing.json");
  const sites = readModelSitesDocument(sitesPath);
  const routing = readRoutingDocument(routingPath);
  if (siteIsReferenced(input.siteId, sites, routing)) {
    throw invalid("Model site is referenced by local defaults or Loop nodes");
  }
  sites.sites = sites.sites.filter((site) => site.siteId !== input.siteId);
  validateSitesDocument(sites);
  atomicWriteJson(sitesPath, sites);
  return sites;
}

export function getModelCatalog(input: { deploymentOrigin: string; userId: string }): ModelCatalogDocument {
  const path = accountDocumentPath(input.deploymentOrigin, input.userId, "model-catalog.json");
  return readCatalogDocument(path);
}

export function saveModelCatalog(input: {
  deploymentOrigin: string;
  userId: string;
  catalog: ModelCatalogDocument;
}): ModelCatalogDocument {
  validateCatalogDocument(input.catalog);
  const path = accountDocumentPath(input.deploymentOrigin, input.userId, "model-catalog.json");
  atomicWriteJson(path, input.catalog);
  return input.catalog;
}

export function getLoopModelRouting(input: { deploymentOrigin: string; userId: string }): LoopModelRoutingDocument {
  const path = accountDocumentPath(input.deploymentOrigin, input.userId, "loop-model-routing.json");
  return readRoutingDocument(path);
}

export function saveLoopModelRouting(input: {
  deploymentOrigin: string;
  userId: string;
  routing: LoopModelRoutingDocument;
}): LoopModelRoutingDocument {
  validateRoutingDocument(input.routing);
  const path = accountDocumentPath(input.deploymentOrigin, input.userId, "loop-model-routing.json");
  atomicWriteJson(path, input.routing);
  return input.routing;
}

export function md5Hex(value: Buffer): string {
  return createHash("md5").update(value).digest("hex");
}

function modelDiscoveryEndpoint(site: ModelSite): string {
  if (!site.baseUrl) {
    throw invalid("Model site base URL is unavailable");
  }
  let parsed: URL;
  try {
    parsed = new URL(site.baseUrl);
  } catch {
    throw invalid("Model site URL is invalid");
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0
  ) {
    throw invalid("Model site URL is invalid");
  }
  const suffix = site.adapter === "ollama" ? "api/tags" : "models";
  const basePath = parsed.pathname.replace(/\/+$/u, "");
  parsed.pathname = `${basePath}/${suffix}`;
  return parsed.toString();
}

function modelDiscoveryCredential(input: {
  deploymentOrigin: string;
  userId: string;
  site: ModelSite;
  credentialOverride?: string;
}): string | null {
  if (input.credentialOverride !== undefined) {
    return normalizeCredential(input.credentialOverride);
  }
  if (input.site.credentialSource === "independent") {
    if (!input.site.credentialRef) {
      throw invalid("Model site credential is unavailable");
    }
    return readAgentCredential(input.deploymentOrigin, input.userId, input.site.credentialRef);
  }
  const value = process.env.OPENAI_API_KEY ?? process.env.OLLAMA_API_KEY;
  return value !== undefined && value.trim().length > 0 ? value : null;
}

async function fetchModelCatalog(input: {
  endpoint: string;
  credential: string | null;
  fetch: LocalModelFetch;
}): Promise<Uint8Array> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (input.credential !== null) {
    headers.Authorization = `Bearer ${input.credential.trim()}`;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let response;
  try {
    response = await input.fetch(input.endpoint, { headers, signal: controller.signal });
  } catch {
    throw invalid("Model site discovery failed");
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw invalid("Model site discovery failed");
  }
  const body = new Uint8Array(await response.arrayBuffer());
  if (body.byteLength > 2 * 1024 * 1024) {
    throw invalid("Model catalog response is too large");
  }
  return body;
}

function jsonStringField(value: unknown, fields: string[], maximum: number): string | null {
  if (!value || typeof value !== "object") return null;
  const object = value as Record<string, unknown>;
  for (const field of fields) {
    const candidate = object[field];
    if (typeof candidate !== "string") continue;
    const trimmed = candidate.trim();
    if (trimmed.length === 0 || trimmed.length > maximum || /[\u0000-\u001F\u007F]/u.test(trimmed)) {
      continue;
    }
    return trimmed;
  }
  return null;
}

function normalizeDiscoveredModels(site: ModelSite, payload: unknown): ModelCatalogSite {
  const object = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
  const collection = object
    ? (site.adapter === "ollama" ? object.models : object.data)
    : undefined;
  if (!Array.isArray(collection)) {
    throw invalid("Model catalog response is invalid");
  }
  const seen = new Set<string>();
  const models: ModelCatalogEntry[] = [];
  for (const item of collection) {
    const name = jsonStringField(item, ["id", "name", "model"], 512);
    if (name === null || seen.has(name)) continue;
    seen.add(name);
    const label = jsonStringField(item, ["name"], 256) ?? name;
    const keyInput = Buffer.concat([Buffer.from(site.siteId, "utf8"), Buffer.from([0]), Buffer.from(name, "utf8")]);
    models.push({ modelKey: md5Hex(keyInput), name, label, manual: false });
    if (models.length >= 10_000) {
      throw invalid("Model catalog contains too many models");
    }
  }
  const catalog: ModelCatalogSite = { refreshedAt: nowIso8601(), models };
  validateCatalogDocument({
    schemaVersion: MODEL_CATALOG_SCHEMA_VERSION,
    sites: { [site.siteId]: catalog },
  });
  return catalog;
}

async function discoverModelSite(input: {
  deploymentOrigin: string;
  userId: string;
  site: ModelSite;
  credentialOverride?: string;
  fetch: LocalModelFetch;
}): Promise<ModelCatalogSite> {
  if (input.site.adapter === "codex_environment") {
    throw invalid("Codex environment model discovery is not supported");
  }
  const endpoint = modelDiscoveryEndpoint(input.site);
  const credential = modelDiscoveryCredential({
    deploymentOrigin: input.deploymentOrigin,
    userId: input.userId,
    site: input.site,
    ...(input.credentialOverride === undefined ? {} : { credentialOverride: input.credentialOverride }),
  });
  const body = await fetchModelCatalog({ endpoint, credential, fetch: input.fetch });
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(body)) as unknown;
  } catch {
    throw invalid("Model catalog response is invalid");
  }
  return normalizeDiscoveredModels(input.site, payload);
}

export async function testAndRefreshModelSite(input: {
  deploymentOrigin: string;
  userId: string;
  site: ModelSite;
  catalog?: ModelCatalogSite;
  credential?: string;
  fetch: LocalModelFetch;
}): Promise<ModelCatalogSite> {
  validateSite(input.site);
  const credential = input.credential !== undefined ? normalizeCredential(input.credential) : undefined;
  const catalog = input.catalog !== undefined
    ? input.catalog
    : await discoverModelSite({
      deploymentOrigin: input.deploymentOrigin,
      userId: input.userId,
      site: input.site,
      ...(credential === undefined ? {} : { credentialOverride: credential }),
      fetch: input.fetch,
    });
  validateCatalogDocument({
    schemaVersion: MODEL_CATALOG_SCHEMA_VERSION,
    sites: { [input.site.siteId]: catalog },
  });
  const document = getModelCatalog({ deploymentOrigin: input.deploymentOrigin, userId: input.userId });
  document.sites[input.site.siteId] = catalog;
  saveModelCatalog({
    deploymentOrigin: input.deploymentOrigin,
    userId: input.userId,
    catalog: document,
  });
  return catalog;
}
