import type {
  AgentLoginBindResponse,
  LocalAgentPlatform,
} from "@humanthread/shared";
import { prisma } from "../../../../../packages/db/src/index";
import { verifyAgentBindingCode } from "./agent-binding-code";
import { registerAgentDevice } from "./agent-device-registration";
import { verifyPasswordHash } from "../workbench/workbench-auth";

export interface LoginAndRegisterAgentDeviceInput {
  email?: string;
  password?: string;
  userId?: string;
  deviceId: string;
  deviceName: string;
  platform: LocalAgentPlatform;
  currentDeviceToken?: string;
  bindingCode?: string;
}

interface AgentLoginUserRecord {
  id: string;
  teamId: string;
  email: string | null;
  status: string;
  passwordHash: string | null;
}

interface LoginAndRegisterAgentDeviceDependencies {
  loadUserForLogin: (input: {
    email?: string;
    userId?: string;
  }) => Promise<AgentLoginUserRecord | null>;
  registerAgentDevice: typeof registerAgentDevice;
  verifyAgentBindingCode?: typeof verifyAgentBindingCode;
  verifyPassword?: (input: {
    password: string;
    passwordHash: string;
  }) => boolean;
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();

  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function normalizeEmail(value: string | undefined): string | undefined {
  return normalizeOptionalText(value)?.toLowerCase();
}

function buildLoginLookupInput({
  email,
  userId,
}: {
  email: string | undefined;
  userId: string | undefined;
}): { email?: string; userId?: string } {
  return {
    ...(email ? { email } : {}),
    ...(userId ? { userId } : {}),
  };
}

export async function loginAndRegisterAgentDevice(
  input: LoginAndRegisterAgentDeviceInput,
  dependencies: LoginAndRegisterAgentDeviceDependencies = {
    loadUserForLogin: async ({ email, userId }) => {
      const select = {
        id: true,
        teamId: true,
        email: true,
        status: true,
        passwordHash: true,
      } as const;

      if (userId) {
        return prisma.user.findUnique({
          where: { id: userId },
          select,
        });
      }

      if (email) {
        return prisma.user.findFirst({
          where: { email },
          select,
        });
      }

      return null;
    },
    registerAgentDevice,
    verifyAgentBindingCode,
  },
): Promise<AgentLoginBindResponse> {
  const email = normalizeEmail(input.email);
  const password = normalizeOptionalText(input.password);
  const bindingCode = normalizeOptionalText(input.bindingCode);
  const verifyBindingCode =
    dependencies.verifyAgentBindingCode ?? verifyAgentBindingCode;
  const verifyPassword = dependencies.verifyPassword ?? verifyPasswordHash;
  const verifiedBinding = bindingCode
    ? verifyBindingCode({ code: bindingCode })
    : null;
  const requestedUserId = normalizeOptionalText(input.userId);
  const userId = verifiedBinding?.userId ?? requestedUserId;

  if (!email && !userId) {
    throw new Error("User email, user ID, or binding code is required");
  }

  if (email && !password && !verifiedBinding) {
    throw new Error("Agent login credentials are invalid");
  }

  if (verifiedBinding && requestedUserId && verifiedBinding.userId !== requestedUserId) {
    throw new Error("Agent binding code does not match the requested user");
  }

  const user = await dependencies.loadUserForLogin(
    buildLoginLookupInput({ email, userId }),
  );

  if (!user || user.status !== "active") {
    throw new Error("Agent login user is unavailable");
  }

  if (email && user.email?.trim().toLowerCase() !== email) {
    throw new Error("Agent login credentials are invalid");
  }

  if (
    password &&
    (!user.passwordHash ||
      !verifyPassword({
        password,
        passwordHash: user.passwordHash,
      }))
  ) {
    throw new Error("Agent login credentials are invalid");
  }

  if (verifiedBinding && verifiedBinding.teamId !== user.teamId) {
    throw new Error("Agent binding code does not match the requested user");
  }

  const currentDeviceToken = normalizeOptionalText(input.currentDeviceToken);
  const trustedBinding = Boolean(verifiedBinding || password);
  const registration = await dependencies.registerAgentDevice({
    userId: user.id,
    deviceId: input.deviceId,
    deviceName: input.deviceName,
    platform: input.platform,
    allowAuthorizedDeviceTokenRotation: trustedBinding,
    ...(trustedBinding ? { authorizeDevice: true } : {}),
    ...(currentDeviceToken ? { currentDeviceToken } : {}),
  });

  return {
    teamId: user.teamId,
    userId: user.id,
    deviceId: registration.deviceId,
    status: registration.status,
    deviceToken: registration.deviceToken,
  };
}
