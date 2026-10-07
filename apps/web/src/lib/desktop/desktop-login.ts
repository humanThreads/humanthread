import type {
  AgentDeviceRegisterResponse,
  AgentDeviceStatus,
  LocalAgentPlatform,
} from "@humanthread/shared";
import { randomBytes } from "node:crypto";

import { prisma } from "../../../../../packages/db/src/index";
import { registerAgentDevice, type RegisterAgentDeviceInput } from "../agent/agent-device-registration";
import { authenticateWorkbenchUser } from "../workbench/workbench-auth";
import {
  createDesktopSessionRecord,
  type DesktopSessionRecord,
  rotateDesktopRefreshToken,
} from "./desktop-session-store";
import { createDesktopAccessToken } from "./desktop-token";

const DESKTOP_REFRESH_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface DesktopUserProfile {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

export interface DesktopLoginResult {
  accessToken: string;
  accessExpiresAt: string;
  refreshToken: string;
  sessionId: string;
  user: DesktopUserProfile;
  device: {
    id: string;
    status: AgentDeviceStatus;
    deviceToken: string;
  };
}

export interface DesktopRefreshResult {
  accessToken: string;
  accessExpiresAt: string;
  refreshToken: string;
  sessionId: string;
}

interface DesktopLoginDependencies {
  authenticateUser: typeof authenticateWorkbenchUser;
  loadUserProfile: (userId: string) => Promise<DesktopUserProfile | null>;
  registerDevice: (input: RegisterAgentDeviceInput) => Promise<AgentDeviceRegisterResponse>;
  createRefreshToken: () => string;
  createSession: (input: Parameters<typeof createDesktopSessionRecord>[0]) => Promise<DesktopSessionRecord>;
  accessTokenSecret?: string;
}

interface DesktopRefreshDependencies {
  createRefreshToken: () => string;
  rotateSession: (input: Parameters<typeof rotateDesktopRefreshToken>[0]) => Promise<DesktopSessionRecord>;
  accessTokenSecret?: string;
}

function createRefreshToken(): string {
  return `ht_desktop_refresh_${randomBytes(32).toString("hex")}`;
}

function defaultLoginDependencies(): DesktopLoginDependencies {
  return {
    authenticateUser: authenticateWorkbenchUser,
    loadUserProfile: async (userId) => {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, name: true, avatarUrl: true, status: true },
      });
      return user?.status === "active" && user.email
        ? { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl }
        : null;
    },
    registerDevice: registerAgentDevice,
    createRefreshToken,
    createSession: createDesktopSessionRecord,
  };
}

function defaultRefreshDependencies(): DesktopRefreshDependencies {
  return {
    createRefreshToken,
    rotateSession: rotateDesktopRefreshToken,
  };
}

function issueAccessToken(input: {
  userId: string;
  sessionId: string;
  now: Date;
  secret?: string;
}) {
  return createDesktopAccessToken({
    userId: input.userId,
    sessionId: input.sessionId,
    now: input.now,
    ...(input.secret ? { secret: input.secret } : {}),
  });
}

export async function loginDesktopSession(
  input: {
    email: string;
    password: string;
    installationId: string;
    deviceId: string;
    deviceName: string;
    platform: LocalAgentPlatform;
    currentDeviceToken?: string;
    now?: Date;
  },
  dependencies: Partial<DesktopLoginDependencies> = {},
): Promise<DesktopLoginResult> {
  const resolved = { ...defaultLoginDependencies(), ...dependencies };
  const now = input.now ?? new Date();
  const authenticated = await resolved.authenticateUser({
    email: input.email,
    password: input.password,
  });
  const user = await resolved.loadUserProfile(authenticated.id);
  if (!user || user.email.trim().toLowerCase() !== authenticated.email) {
    throw new Error("Desktop login user is unavailable");
  }

  const registration = await resolved.registerDevice({
    userId: user.id,
    deviceId: input.deviceId,
    deviceName: input.deviceName,
    platform: input.platform,
    authorizeDevice: true,
    allowAuthorizedDeviceTokenRotation: true,
    now,
    ...(input.currentDeviceToken ? { currentDeviceToken: input.currentDeviceToken } : {}),
  });
  const refreshToken = resolved.createRefreshToken();
  const session = await resolved.createSession({
    userId: user.id,
    installationId: input.installationId,
    deviceId: registration.deviceId,
    refreshToken,
    expiresAt: new Date(now.getTime() + DESKTOP_REFRESH_SESSION_TTL_MS),
    now,
  });
  const access = issueAccessToken({
    userId: user.id,
    sessionId: session.id,
    now,
    ...(resolved.accessTokenSecret ? { secret: resolved.accessTokenSecret } : {}),
  });

  return {
    accessToken: access.accessToken,
    accessExpiresAt: access.expiresAt.toISOString(),
    refreshToken,
    sessionId: session.id,
    user,
    device: {
      id: registration.deviceId,
      status: registration.status,
      deviceToken: registration.deviceToken,
    },
  };
}

export async function refreshDesktopSession(
  input: { sessionId: string; refreshToken: string; now?: Date },
  dependencies: Partial<DesktopRefreshDependencies> = {},
): Promise<DesktopRefreshResult> {
  const resolved = { ...defaultRefreshDependencies(), ...dependencies };
  const now = input.now ?? new Date();
  const nextRefreshToken = resolved.createRefreshToken();
  const session = await resolved.rotateSession({
    sessionId: input.sessionId,
    currentRefreshToken: input.refreshToken,
    nextRefreshToken,
    now,
  });
  const access = issueAccessToken({
    userId: session.userId,
    sessionId: session.id,
    now,
    ...(resolved.accessTokenSecret ? { secret: resolved.accessTokenSecret } : {}),
  });

  return {
    accessToken: access.accessToken,
    accessExpiresAt: access.expiresAt.toISOString(),
    refreshToken: nextRefreshToken,
    sessionId: session.id,
  };
}
