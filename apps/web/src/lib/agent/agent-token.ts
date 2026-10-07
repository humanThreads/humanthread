import { randomBytes } from "node:crypto";
import { prisma } from "../../../../../packages/db/src/index";
import { hashAgentToken } from "./agent-auth";

export interface RotateAgentTokenInput {
  userId: string;
}

interface RotateAgentTokenDependencies {
  createToken: () => string;
  updateUserTokenHash: (input: {
    userId: string;
    tokenHash: string;
  }) => Promise<void>;
}

function createAgentToken(): string {
  return `ht_local_${randomBytes(18).toString("hex")}`;
}

export async function rotateAgentToken(
  input: RotateAgentTokenInput,
  dependencies: RotateAgentTokenDependencies = {
    createToken: createAgentToken,
    updateUserTokenHash: async ({ userId, tokenHash }) => {
      await prisma.user.update({
        where: { id: userId },
        data: {
          agentApiTokenHash: tokenHash,
        },
      });
    },
  },
): Promise<{
  userId: string;
  token: string;
}> {
  const token = dependencies.createToken();
  const tokenHash = hashAgentToken(token);

  await dependencies.updateUserTokenHash({
    userId: input.userId,
    tokenHash,
  });

  return {
    userId: input.userId,
    token,
  };
}
