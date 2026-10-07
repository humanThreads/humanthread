import { createHash, timingSafeEqual } from "node:crypto";
import { prisma } from "../../../../../packages/db/src/index";

export interface AuthenticateAgentRequestInput {
  authorizationHeader: string | null;
  userId: string;
  expectedTeamId?: string;
  deviceId?: string;
  deviceTokenHeader?: string | null;
  requireAuthorizedDevice?: boolean;
  allowDeviceTokenOnly?: boolean;
}

interface AgentUserAuthRecord {
  id: string;
  teamId: string;
  status: string;
  agentApiTokenHash: string | null;
}

interface AuthenticateAgentRequestDependencies {
  loadUserAuth: (input: { userId: string }) => Promise<AgentUserAuthRecord | null>;
  loadDeviceAuth: (input: {
    deviceId: string;
  }) => Promise<{
    id: string;
    userId: string;
    status: string;
    deviceTokenHash: string | null;
  } | null>;
}

export interface AuthenticatedAgentContext {
  userId: string;
  teamId: string;
  deviceId?: string;
}

function parseBearerToken(headerValue: string | null): string {
  if (!headerValue) {
    throw new Error("Missing agent authorization token");
  }

  const match = headerValue.match(/^Bearer\s+(.+)$/u);

  if (!match?.[1]?.trim()) {
    throw new Error("Missing agent authorization token");
  }

  return match[1].trim();
}

export function hashAgentToken(token: string): string {
  return createHash("sha256").update(token.trim()).digest("hex");
}

function compareTokenHash(rawToken: string, expectedHash: string | null): boolean {
  if (!expectedHash?.trim()) {
    return false;
  }

  const actual = Buffer.from(hashAgentToken(rawToken), "utf8");
  const expected = Buffer.from(expectedHash.trim(), "utf8");

  if (actual.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(actual, expected);
}

export async function authenticateAgentRequest(
  input: AuthenticateAgentRequestInput,
  dependencies: AuthenticateAgentRequestDependencies = {
    loadUserAuth: async ({ userId }) =>
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          teamId: true,
          status: true,
          agentApiTokenHash: true,
        },
      }),
    loadDeviceAuth: async ({ deviceId }) =>
      prisma.localDevice.findUnique({
        where: { id: deviceId },
        select: {
          id: true,
          userId: true,
          status: true,
          deviceTokenHash: true,
        },
      }),
  },
): Promise<AuthenticatedAgentContext> {
  const hasAuthorizationHeader = Boolean(input.authorizationHeader?.trim());

  if (!hasAuthorizationHeader && !input.allowDeviceTokenOnly) {
    throw new Error("Missing agent authorization token");
  }

  const rawToken = hasAuthorizationHeader
    ? parseBearerToken(input.authorizationHeader)
    : null;
  const user = await dependencies.loadUserAuth({
    userId: input.userId,
  });

  if (!user || user.status !== "active") {
    throw new Error("Agent user is unavailable");
  }

  if (input.expectedTeamId && user.teamId !== input.expectedTeamId) {
    throw new Error("Agent user does not belong to the requested team");
  }

  const bearerTokenValid = !rawToken || compareTokenHash(rawToken, user.agentApiTokenHash);
  const mayUseDeviceTokenOnly = input.allowDeviceTokenOnly === true && input.requireAuthorizedDevice === true;
  if (rawToken && !bearerTokenValid && !mayUseDeviceTokenOnly) {
    throw new Error("Invalid agent authorization token");
  }

  if (input.requireAuthorizedDevice) {
    if (!input.deviceId?.trim()) {
      throw new Error("Missing agent device ID");
    }

    const device = await dependencies.loadDeviceAuth({
      deviceId: input.deviceId.trim(),
    });

    if (!device || device.userId !== user.id) {
      throw new Error("Agent device is unavailable");
    }

    if (device.status !== "authorized") {
      throw new Error("Agent device is not authorized");
    }

    if (!input.deviceTokenHeader?.trim()) {
      throw new Error("Missing agent device token");
    }

    if (!compareTokenHash(input.deviceTokenHeader, device.deviceTokenHash)) {
      throw new Error("Invalid agent device token");
    }
  } else if (!rawToken) {
    throw new Error("Missing agent authorization token");
  }

  return {
    userId: user.id,
    teamId: user.teamId,
    ...(input.deviceId?.trim() ? { deviceId: input.deviceId.trim() } : {}),
  };
}
