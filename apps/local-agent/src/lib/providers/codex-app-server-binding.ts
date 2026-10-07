import { sha256 } from "@noble/hashes/sha2.js";

export type CodexDaemonBindingInput = {
  deploymentOrigin: string | null;
  userId: string | null;
  credentialRef: string | null;
  providerBaseUrl: string | null;
  executable: string;
  environmentRefs: string[];
};

function normalizeOptional(value: string | null): string {
  const normalized = value?.trim().replace(/\/+$/u, "") ?? "";
  return normalized || "environment";
}

function normalizeExecutable(value: string): string {
  const normalized = value.trim();
  return normalized || "codex";
}

function encodeUtf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function buildCodexDaemonProcessKey(input: CodexDaemonBindingInput): string {
  const normalized = {
    deploymentOrigin: normalizeOptional(input.deploymentOrigin),
    userId: normalizeOptional(input.userId),
    credentialRef: normalizeOptional(input.credentialRef),
    providerBaseUrl: normalizeOptional(input.providerBaseUrl),
    executable: normalizeExecutable(input.executable),
    environmentRefs: [...new Set(input.environmentRefs.map((value) => value.trim()).filter(Boolean))].sort(),
  };
  const digest = sha256(encodeUtf8(JSON.stringify(normalized)));
  return `codex-daemon:${toHex(digest)}`;
}
