import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export type LiveSessionTicketKind = "control" | "execution" | "viewer";

interface LiveSessionTicketPayload {
  version: 1;
  jti: string;
  sessionId: string;
  kind: LiveSessionTicketKind;
  iat: number;
  exp: number;
}

const TICKET_PREFIX = "lst1";
const TICKET_TTL_SECONDS = 60;
const SESSION_ID_PATTERN = /^[a-f0-9]{32}$/u;

function ticketError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function resolveSecret(secret?: string): string {
  const resolved = secret?.trim() || process.env.HUMANTHREAD_DESKTOP_SESSION_SECRET?.trim();
  if (!resolved) throw ticketError("live_session_gateway_unavailable", "Live session ticket secret is not configured");
  return resolved;
}

function safeEquals(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function sign(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

function encodePayload(payload: LiveSessionTicketPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodePayload(encodedPayload: string, now: Date, secret: string): LiveSessionTicketPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    throw ticketError("live_session_ticket_invalid", "Live session ticket is invalid");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw ticketError("live_session_ticket_invalid", "Live session ticket is invalid");
  }
  const payload = parsed as Record<string, unknown>;
  if (
    payload.version !== 1
    || typeof payload.jti !== "string"
    || !payload.jti.trim()
    || typeof payload.sessionId !== "string"
    || !SESSION_ID_PATTERN.test(payload.sessionId)
    || (payload.kind !== "control" && payload.kind !== "execution" && payload.kind !== "viewer")
    || !Number.isInteger(payload.iat)
    || !Number.isInteger(payload.exp)
  ) {
    throw ticketError("live_session_ticket_invalid", "Live session ticket is invalid");
  }
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (Number(payload.exp) <= nowSeconds) {
    throw ticketError("live_session_ticket_expired", "Live session ticket has expired");
  }
  if (Number(payload.iat) > nowSeconds + 5) {
    throw ticketError("live_session_ticket_invalid", "Live session ticket was issued in the future");
  }
  void secret;
  return payload as unknown as LiveSessionTicketPayload;
}

export function createLiveSessionTicket(input: {
  sessionId: string;
  kind: LiveSessionTicketKind;
  now?: Date;
  secret?: string;
}): { token: string; expiresAt: Date } {
  if (!SESSION_ID_PATTERN.test(input.sessionId)) {
    throw ticketError("live_session_invalid", "Live session id is invalid");
  }
  const now = input.now ?? new Date();
  const issuedAt = Math.floor(now.getTime() / 1000);
  const expiresAtSeconds = issuedAt + TICKET_TTL_SECONDS;
  const payload: LiveSessionTicketPayload = {
    version: 1,
    jti: randomUUID().replaceAll("-", ""),
    sessionId: input.sessionId,
    kind: input.kind,
    iat: issuedAt,
    exp: expiresAtSeconds,
  };
  const encodedPayload = encodePayload(payload);
  const signature = sign(encodedPayload, resolveSecret(input.secret));
  return {
    token: `${TICKET_PREFIX}.${encodedPayload}.${signature}`,
    expiresAt: new Date(expiresAtSeconds * 1000),
  };
}

export function verifyLiveSessionTicket(input: {
  ticket: string;
  now?: Date;
  secret?: string;
  expectedKind?: LiveSessionTicketKind;
}): { sessionId: string; kind: LiveSessionTicketKind; expiresAt: Date; ticketId: string } {
  const [prefix, encodedPayload, signature] = input.ticket.trim().split(".");
  if (prefix !== TICKET_PREFIX || !encodedPayload || !signature) {
    throw ticketError("live_session_ticket_invalid", "Live session ticket is invalid");
  }
  const secret = resolveSecret(input.secret);
  if (!safeEquals(signature, sign(encodedPayload, secret))) {
    throw ticketError("live_session_ticket_invalid", "Live session ticket is invalid");
  }
  const payload = decodePayload(encodedPayload, input.now ?? new Date(), secret);
  if (input.expectedKind && payload.kind !== input.expectedKind) {
    throw ticketError("live_session_ticket_invalid", "Live session ticket kind is invalid");
  }
  return {
    sessionId: payload.sessionId,
    kind: payload.kind,
    expiresAt: new Date(payload.exp * 1000),
    ticketId: createHash("sha256").update(payload.jti).digest("hex"),
  };
}

export async function consumeLiveSessionTicket(input: {
  ticket: string;
  now?: Date;
  secret?: string;
  expectedKind?: LiveSessionTicketKind;
  consume(ticketId: string): Promise<boolean>;
}): Promise<{ sessionId: string; kind: LiveSessionTicketKind; expiresAt: Date }> {
  const verified = verifyLiveSessionTicket(input);
  if (!await input.consume(verified.ticketId)) {
    throw ticketError("live_session_ticket_used", "Live session ticket has already been used");
  }
  return {
    sessionId: verified.sessionId,
    kind: verified.kind,
    expiresAt: verified.expiresAt,
  };
}
