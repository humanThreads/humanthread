import { createHash, randomBytes } from "node:crypto";
import {
  derivedPersistenceId,
  prisma,
} from "../../../../../packages/db/src/index";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LAST_SEEN_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export type WebSessionActor = {
  userId: string;
  webSessionId: string;
  email: string;
};

export type WebSessionSummary = {
  id: string;
  deviceName: string;
  browserName: string;
  operatingSystem: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
};

interface PersistedSession extends WebSessionSummary {
  userId: string;
}

interface ResolvedSession extends PersistedSession {
  status: string;
  revokedAt: Date | null;
  user: { email: string | null; status: string };
}

interface CreateWebSessionDb {
  webSession: {
    create(input: { data: Record<string, unknown> }): Promise<PersistedSession>;
  };
}

interface ResolveWebSessionDb {
  webSession: {
    findUnique(input: Record<string, unknown>): Promise<ResolvedSession | null>;
    updateMany(input: Record<string, unknown>): Promise<{ count: number }>;
  };
}

interface ListWebSessionDb {
  webSession: {
    findMany(input: Record<string, unknown>): Promise<PersistedSession[]>;
  };
}

interface RevokeWebSessionDb {
  webSession: {
    updateMany(input: Record<string, unknown>): Promise<{ count: number }>;
  };
}

export interface WebSessionRequestMetadata {
  deviceName: string;
  browserName: string;
  operatingSystem: string;
  userAgent: string;
  ipAddress: string | null;
}

function truncate(value: string, maximum: number): string {
  return value.slice(0, maximum);
}

function detectBrowser(userAgent: string): string {
  if (/Edg\//u.test(userAgent)) return "Edge";
  if (/Firefox\//u.test(userAgent)) return "Firefox";
  if (/Chrome\//u.test(userAgent)) return "Chrome";
  if (/Safari\//u.test(userAgent)) return "Safari";
  return "Unknown browser";
}

function detectOperatingSystem(userAgent: string): string {
  if (/Windows/u.test(userAgent)) return "Windows";
  if (/Android/u.test(userAgent)) return "Android";
  if (/iPhone|iPad/u.test(userAgent)) return "iOS";
  if (/Macintosh|Mac OS X/u.test(userAgent)) return "macOS";
  if (/Linux/u.test(userAgent)) return "Linux";
  return "Unknown system";
}

export function parseWebSessionRequestMetadata(
  request: Request,
): WebSessionRequestMetadata {
  const userAgent = truncate(request.headers.get("user-agent")?.trim() ?? "", 512);
  const browserName = truncate(detectBrowser(userAgent), 64);
  const operatingSystem = truncate(detectOperatingSystem(userAgent), 64);
  const forwardedAddress = request.headers
    .get("x-forwarded-for")
    ?.split(",")[0]
    ?.trim();
  const ipAddress = truncate(
    forwardedAddress || request.headers.get("x-real-ip")?.trim() || "",
    64,
  ) || null;

  return {
    deviceName: truncate(
      operatingSystem === "Unknown system" ? "Unknown device" : operatingSystem,
      191,
    ),
    browserName,
    operatingSystem,
    userAgent,
    ipAddress,
  };
}

export function hashWebSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createWebSession(input: {
  userId: string;
  request: Request;
  now?: Date;
  generateToken?: () => string;
  db?: CreateWebSessionDb;
}): Promise<{ token: string; session: WebSessionSummary & { userId: string } }> {
  const now = input.now ?? new Date();
  const token = input.generateToken?.() ?? randomBytes(32).toString("base64url");
  const tokenHash = hashWebSessionToken(token);
  const metadata = parseWebSessionRequestMetadata(input.request);
  const session = await (input.db ?? (prisma as unknown as CreateWebSessionDb)).webSession.create({
    data: {
      id: derivedPersistenceId(["web-session", input.userId, tokenHash]),
      userId: input.userId,
      tokenHash,
      ...metadata,
      status: "active",
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    },
  });

  return {
    token,
    session: {
      id: session.id,
      userId: session.userId,
      deviceName: session.deviceName,
      browserName: session.browserName,
      operatingSystem: session.operatingSystem,
      createdAt: session.createdAt,
      lastSeenAt: session.lastSeenAt,
      expiresAt: session.expiresAt,
    },
  };
}

export async function resolveActiveWebSession(input: {
  token: string;
  now?: Date;
  db?: ResolveWebSessionDb;
}): Promise<WebSessionActor | null> {
  const now = input.now ?? new Date();
  const db = input.db ?? (prisma as unknown as ResolveWebSessionDb);
  const session = await db.webSession.findUnique({
    where: { tokenHash: hashWebSessionToken(input.token) },
    select: {
      id: true,
      userId: true,
      status: true,
      revokedAt: true,
      expiresAt: true,
      lastSeenAt: true,
      user: { select: { email: true, status: true } },
    },
  });

  if (
    !session ||
    session.status !== "active" ||
    session.revokedAt ||
    session.expiresAt <= now ||
    session.user.status !== "active" ||
    !session.user.email
  ) {
    return null;
  }

  if (now.getTime() - session.lastSeenAt.getTime() >= LAST_SEEN_TOUCH_INTERVAL_MS) {
    await db.webSession.updateMany({
      where: {
        id: session.id,
        status: "active",
        revokedAt: null,
        lastSeenAt: { lte: new Date(now.getTime() - LAST_SEEN_TOUCH_INTERVAL_MS) },
      },
      data: { lastSeenAt: now },
    });
  }

  return {
    userId: session.userId,
    webSessionId: session.id,
    email: session.user.email,
  };
}

export async function listActiveWebSessions(input: {
  userId: string;
  now?: Date;
  db?: ListWebSessionDb;
}): Promise<WebSessionSummary[]> {
  const now = input.now ?? new Date();
  const rows = await (input.db ?? (prisma as unknown as ListWebSessionDb)).webSession.findMany({
    where: {
      userId: input.userId,
      status: "active",
      revokedAt: null,
      expiresAt: { gt: now },
    },
    select: {
      id: true,
      deviceName: true,
      browserName: true,
      operatingSystem: true,
      createdAt: true,
      lastSeenAt: true,
      expiresAt: true,
    },
    orderBy: { lastSeenAt: "desc" },
  });

  return rows.map(({ id, deviceName, browserName, operatingSystem, createdAt, lastSeenAt, expiresAt }) => ({
    id,
    deviceName,
    browserName,
    operatingSystem,
    createdAt,
    lastSeenAt,
    expiresAt,
  }));
}

export async function revokeWebSession(input: {
  userId: string;
  targetSessionId: string;
  reason: "user_logout" | "remote_logout";
  now?: Date;
  db?: RevokeWebSessionDb;
}): Promise<void> {
  const now = input.now ?? new Date();
  await (input.db ?? (prisma as unknown as RevokeWebSessionDb)).webSession.updateMany({
    where: {
      id: input.targetSessionId,
      userId: input.userId,
      status: "active",
      revokedAt: null,
    },
    data: {
      status: "revoked",
      revokedAt: now,
      revokedReason: input.reason,
    },
  });
}

export async function revokeOtherWebSessions(input: {
  userId: string;
  currentSessionId: string;
  reason: "password_changed";
  now?: Date;
  db?: RevokeWebSessionDb;
}): Promise<number> {
  const now = input.now ?? new Date();
  const result = await (input.db ?? (prisma as unknown as RevokeWebSessionDb)).webSession.updateMany({
    where: {
      userId: input.userId,
      id: { not: input.currentSessionId },
      status: "active",
      revokedAt: null,
    },
    data: {
      status: "revoked",
      revokedAt: now,
      revokedReason: input.reason,
    },
  });
  return result.count;
}
