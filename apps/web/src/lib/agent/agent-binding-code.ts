import { createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_BINDING_CODE_TTL_MS = 10 * 60 * 1000;
const BINDING_CODE_VERSION = "v1";

export interface AgentBindingCodePayload {
  userId: string;
  teamId: string;
  expiresAt: Date;
}

export interface CreateAgentBindingCodeInput {
  userId: string;
  teamId: string;
  now?: Date;
  secret?: string;
}

export interface CreateAgentBindingCodeResult {
  code: string;
  expiresAt: Date;
}

export interface VerifyAgentBindingCodeInput {
  code: string;
  now?: Date;
  secret?: string;
}

function resolveSecret(secret?: string): string {
  const resolved = secret?.trim() || process.env.HUMANTHREAD_BINDING_CODE_SECRET?.trim();

  if (!resolved) {
    throw new Error("Agent binding code secret is not configured");
  }

  return resolved;
}

function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function createAgentBindingCode(
  input: CreateAgentBindingCodeInput,
): CreateAgentBindingCodeResult {
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + DEFAULT_BINDING_CODE_TTL_MS);
  const payload = {
    userId: input.userId,
    teamId: input.teamId,
    exp: expiresAt.getTime(),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = signPayload(encodedPayload, resolveSecret(input.secret));

  return {
    code: `${BINDING_CODE_VERSION}.${encodedPayload}.${signature}`,
    expiresAt,
  };
}

export function verifyAgentBindingCode(
  input: VerifyAgentBindingCodeInput,
): AgentBindingCodePayload {
  const [version, encodedPayload, signature] = input.code.trim().split(".");

  if (version !== BINDING_CODE_VERSION || !encodedPayload || !signature) {
    throw new Error("Agent binding code is invalid");
  }

  const expectedSignature = signPayload(encodedPayload, resolveSecret(input.secret));

  if (!safeEquals(signature, expectedSignature)) {
    throw new Error("Agent binding code is invalid");
  }

  const payload = JSON.parse(
    Buffer.from(encodedPayload, "base64url").toString("utf8"),
  ) as {
    userId?: string;
    teamId?: string;
    exp?: number;
  };

  if (!payload.userId || !payload.teamId || !payload.exp) {
    throw new Error("Agent binding code is invalid");
  }

  const now = input.now ?? new Date();

  if (now.getTime() > payload.exp) {
    throw new Error("Agent binding code has expired");
  }

  return {
    userId: payload.userId,
    teamId: payload.teamId,
    expiresAt: new Date(payload.exp),
  };
}
