import { z } from "zod";

export const agentProviderSchema = z.enum(["codex", "claude"]);
export type AgentProvider = z.infer<typeof agentProviderSchema>;

export const agentRuntimeInstallResultSchema = z.object({
  provider: agentProviderSchema,
  packageName: z.string().trim().min(1).max(128),
  status: z.literal("installed"),
}).strict();

export type AgentRuntimeInstallResult = z.infer<typeof agentRuntimeInstallResultSchema>;

export const agentRuntimeEnvironmentRefs = [
  "CODEX_HOME",
  "CLAUDE_CONFIG_DIR",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_ORGANIZATION",
  "OPENAI_PROJECT",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
] as const;

export const runtimeProbeResultSchema = z.object({
  provider: agentProviderSchema,
  status: z.enum(["ready", "missing", "unauthenticated"]),
  semanticVersion: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u).nullable(),
  authentication: z.enum(["authenticated", "unauthenticated", "unknown"]),
  capabilities: z.array(z.string().trim().min(1).max(64)).max(64),
}).strict();

export type RuntimeProbeResult = z.infer<typeof runtimeProbeResultSchema>;

export type LocalWorkspaceConfiguration = {
  projectId: string;
  bindingId?: string | null;
  absolutePath: string;
  realpath: string;
  configurationVersion: number;
  pathFingerprint: string;
};

export type LocalRuntimeConfiguration = {
  runtimeProfileId?: string | null;
  provider: AgentProvider;
  command: string;
  environmentRefs: string[];
  credentialRef?: string | null;
  version: number;
};

export type WorkspaceUpload = {
  pathFingerprint: string;
  configurationVersion: number;
};

export type RuntimeProfileUpload = {
  provider: AgentProvider;
  label: string;
  status: RuntimeProbeResult["status"];
  capabilities: string[];
  version: number;
};

const rawRuntimeProbeSchema = z.object({
  provider: agentProviderSchema,
  exitCode: z.number().int().nullable(),
  stdout: z.string().max(16_384),
  stderr: z.string().max(16_384),
}).strict().superRefine((value, context) => {
  if (value.stdout.length + value.stderr.length > 16_384) {
    context.addIssue({ code: "custom", message: "Runtime probe output exceeds 16 KiB" });
  }
});

const VERSION_PATTERN = /(?:^|[^0-9])(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)(?:$|[^0-9A-Za-z.+-])/u;
const UNAUTHENTICATED_PATTERN = /(?:login required|not logged in|unauthenticated|authentication required)/iu;

export async function computePathFingerprint(
  realpath: string,
  installationKey: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(installationKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(realpath),
  ));
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  const base64url = btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
  return `hmac-sha256:${base64url}`;
}

export function buildWorkspaceUpload(
  workspace: LocalWorkspaceConfiguration | null,
): WorkspaceUpload {
  if (!workspace) throw new Error("Workspace is not configured");
  return {
    pathFingerprint: workspace.pathFingerprint,
    configurationVersion: workspace.configurationVersion,
  };
}

export function sanitizeRuntimeProbe(input: unknown): RuntimeProbeResult {
  const parsed = rawRuntimeProbeSchema.parse(input);
  const output = `${parsed.stdout}\n${parsed.stderr}`;
  const semanticVersion = output.match(VERSION_PATTERN)?.[1] ?? null;
  const unauthenticated = UNAUTHENTICATED_PATTERN.test(output);
  const status = parsed.exitCode === 0
    ? "ready"
    : unauthenticated
      ? "unauthenticated"
      : "missing";
  return runtimeProbeResultSchema.parse({
    provider: parsed.provider,
    status,
    semanticVersion,
    authentication: parsed.exitCode === 0
      ? "authenticated"
      : unauthenticated
        ? "unauthenticated"
        : "unknown",
    capabilities: [],
  });
}

export function buildRuntimeProfileUpload(
  runtime: LocalRuntimeConfiguration,
  probe: RuntimeProbeResult,
): RuntimeProfileUpload {
  const parsedProbe = runtimeProbeResultSchema.parse(probe);
  if (runtime.provider !== parsedProbe.provider) {
    throw new Error("Runtime provider does not match its probe");
  }
  const providerLabel = runtime.provider === "codex" ? "Codex" : "Claude";
  const capabilities = [...new Set(parsedProbe.capabilities)].sort();
  return {
    provider: runtime.provider,
    label: parsedProbe.semanticVersion
      ? `${providerLabel} ${parsedProbe.semanticVersion}`
      : providerLabel,
    status: parsedProbe.status,
    capabilities,
    version: runtime.version,
  };
}
