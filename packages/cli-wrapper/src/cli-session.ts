import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface CliSession {
  baseUrl: string;
  installationId: string;
  deviceId: string;
  sessionId: string;
  accessToken: string;
  accessExpiresAt: string;
  refreshToken: string;
}

type StoredCliSession = CliSession & { version: 1 };

function invalidSession(): Error {
  return Object.assign(new Error("Run ht login before ht init"), { code: "authentication_required" });
}

function requireString(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw invalidSession();
  return value;
}

export function defaultCliSessionPath(environment: NodeJS.ProcessEnv = process.env): string {
  const configHome = environment.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config");
  return join(configHome, "humanthread", "cli-session.json");
}

export function createCliInstallation(): { installationId: string; deviceId: string } {
  const entropy = randomBytes(32).toString("hex");
  return {
    installationId: `ht-cli-${entropy.slice(0, 32)}`,
    deviceId: createHash("sha256").update(`ht-cli:${entropy}`).digest("hex"),
  };
}

function parseSession(raw: string): CliSession {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw invalidSession(); }
  if (!value || typeof value !== "object") throw invalidSession();
  const session = value as Partial<StoredCliSession>;
  if (session.version !== 1) throw invalidSession();
  const baseUrl = requireString(session.baseUrl);
  const installationId = requireString(session.installationId);
  const deviceId = requireString(session.deviceId);
  const sessionId = requireString(session.sessionId);
  const accessToken = requireString(session.accessToken);
  const accessExpiresAt = requireString(session.accessExpiresAt);
  const refreshToken = requireString(session.refreshToken);
  try { new URL(baseUrl); } catch { throw invalidSession(); }
  return {
    baseUrl: baseUrl.replace(/\/+$/u, ""),
    installationId,
    deviceId,
    sessionId,
    accessToken,
    accessExpiresAt,
    refreshToken,
  };
}

export async function loadCliSession(path = defaultCliSessionPath()): Promise<CliSession> {
  try { return parseSession(await readFile(path, "utf8")); } catch (error) {
    if (error && typeof error === "object" && "code" in error && Reflect.get(error, "code") === "ENOENT") throw invalidSession();
    throw error;
  }
}

export async function saveCliSession(session: CliSession, path = defaultCliSessionPath()): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify({ version: 1, ...session })}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600);
}
