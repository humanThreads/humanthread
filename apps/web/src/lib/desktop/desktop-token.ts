import { createHmac, timingSafeEqual } from "node:crypto";

const DESKTOP_ACCESS_TOKEN_VERSION = "v1";
const DESKTOP_ACCESS_TOKEN_AUDIENCE = "humanthread-desktop";
const DESKTOP_ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

export interface CreateDesktopAccessTokenInput {
  userId: string;
  sessionId: string;
  now?: Date;
  secret?: string;
}

export interface CreatedDesktopAccessToken {
  accessToken: string;
  expiresAt: Date;
}

export interface VerifiedDesktopAccessToken {
  userId: string;
  sessionId: string;
  issuedAt: Date;
  expiresAt: Date;
}

function resolveDesktopSessionSecret(secret?: string): string {
  const resolved = secret?.trim() || process.env.HUMANTHREAD_DESKTOP_SESSION_SECRET?.trim();
  if (!resolved) {
    throw new Error("Desktop session secret is not configured");
  }
  return resolved;
}

function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function requireSubject(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${name} is required`);
  }
  return normalized;
}

export function createDesktopAccessToken(
  input: CreateDesktopAccessTokenInput,
): CreatedDesktopAccessToken {
  const now = input.now ?? new Date();
  const issuedAt = Math.floor(now.getTime() / 1000);
  const expiresAt = issuedAt + DESKTOP_ACCESS_TOKEN_TTL_SECONDS;
  const encodedPayload = Buffer.from(
    JSON.stringify({
      sub: requireSubject(input.userId, "Desktop access token userId"),
      sid: requireSubject(input.sessionId, "Desktop access token sessionId"),
      aud: DESKTOP_ACCESS_TOKEN_AUDIENCE,
      iat: issuedAt,
      exp: expiresAt,
    }),
  ).toString("base64url");
  const signature = signPayload(encodedPayload, resolveDesktopSessionSecret(input.secret));

  return {
    accessToken: `${DESKTOP_ACCESS_TOKEN_VERSION}.${encodedPayload}.${signature}`,
    expiresAt: new Date(expiresAt * 1000),
  };
}

export function verifyDesktopAccessToken(input: {
  token: string;
  now?: Date;
  secret?: string;
}): VerifiedDesktopAccessToken {
  const [version, encodedPayload, signature] = input.token.trim().split(".");
  if (version !== DESKTOP_ACCESS_TOKEN_VERSION || !encodedPayload || !signature) {
    throw new Error("Desktop access token is invalid");
  }

  const expectedSignature = signPayload(
    encodedPayload,
    resolveDesktopSessionSecret(input.secret),
  );
  if (!safeEquals(signature, expectedSignature)) {
    throw new Error("Desktop access token is invalid");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    throw new Error("Desktop access token is invalid");
  }
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Desktop access token is invalid");
  }

  const tokenPayload = payload as Record<string, unknown>;
  if (tokenPayload.aud !== DESKTOP_ACCESS_TOKEN_AUDIENCE) {
    throw new Error("Desktop access token audience is invalid");
  }
  if (
    typeof tokenPayload.sub !== "string" ||
    !tokenPayload.sub.trim() ||
    typeof tokenPayload.sid !== "string" ||
    !tokenPayload.sid.trim() ||
    typeof tokenPayload.iat !== "number" ||
    !Number.isInteger(tokenPayload.iat) ||
    typeof tokenPayload.exp !== "number" ||
    !Number.isInteger(tokenPayload.exp)
  ) {
    throw new Error("Desktop access token is invalid");
  }

  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (nowSeconds >= tokenPayload.exp) {
    throw new Error("Desktop access token has expired");
  }

  return {
    userId: tokenPayload.sub,
    sessionId: tokenPayload.sid,
    issuedAt: new Date(tokenPayload.iat * 1000),
    expiresAt: new Date(tokenPayload.exp * 1000),
  };
}
