import { prisma } from "../../../../../packages/db/src/index";
import { createAgentBindingCode } from "./agent-binding-code";

export interface IssueAgentBindingCodeInput {
  userId?: string;
  email?: string;
}

interface IssueAgentBindingCodeDependencies {
  loadUser: (input: {
    userId?: string;
    email?: string;
  }) => Promise<{
    id: string;
    teamId: string;
    status: string;
  } | null>;
  createAgentBindingCode: typeof createAgentBindingCode;
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();

  return trimmed ? trimmed : undefined;
}

function normalizeEmail(value: string | undefined): string | undefined {
  return normalizeOptionalText(value)?.toLowerCase();
}

export async function issueAgentBindingCode(
  input: IssueAgentBindingCodeInput,
  dependencies: IssueAgentBindingCodeDependencies = {
    loadUser: async ({ userId, email }) => {
      const select = {
        id: true,
        teamId: true,
        status: true,
      } as const;

      if (userId) {
        return prisma.user.findUnique({
          where: { id: userId },
          select,
        });
      }

      if (email) {
        return prisma.user.findFirst({
          where: {
            email,
            status: "active",
          },
          select,
        });
      }

      return null;
    },
    createAgentBindingCode,
  },
): Promise<{
  userId: string;
  teamId: string;
  code: string;
  expiresAt: Date;
}> {
  const userId = normalizeOptionalText(input.userId);
  const email = normalizeEmail(input.email);

  if (!userId && !email) {
    throw new Error("User ID or email is required");
  }

  const user = await dependencies.loadUser({
    ...(userId ? { userId } : {}),
    ...(!userId && email ? { email } : {}),
  });

  if (!user || user.status !== "active") {
    throw new Error("Agent binding code user is unavailable");
  }

  const bindingCode = dependencies.createAgentBindingCode({
    userId: user.id,
    teamId: user.teamId,
  });

  return {
    userId: user.id,
    teamId: user.teamId,
    code: bindingCode.code,
    expiresAt: bindingCode.expiresAt,
  };
}
