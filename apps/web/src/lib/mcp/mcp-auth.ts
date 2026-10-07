import { createCipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { prisma } from "../../../../../packages/db/src/index";

export interface McpCredentialView {
  credentialId: string;
  userId: string;
  name: string;
  token: string;
}

interface McpCredentialRow {
  id: string;
  userId: string;
  name: string;
  status: string;
  revokedAt: Date | null;
  tokenHash: string;
  user: {
    id: string;
    status: string;
  } | null;
}

interface IssueMcpCredentialDependencies {
  createToken: () => string;
  createCredential: (input: {
    userId: string;
    name: string;
    tokenHash: string;
    status: "active";
  }) => Promise<{
    id: string;
    userId: string;
    name: string;
  }>;
}

interface AuthenticateMcpRequestDependencies {
  loadCredential: (input: { tokenHash: string }) => Promise<McpCredentialRow | null>;
  touchCredential: (input: { credentialId: string; now: Date }) => Promise<void>;
}

export interface AuthenticateMcpRequestInput {
  authorizationHeader: string | null;
}

export interface AuthenticatedMcpContext {
  credentialId: string;
  userId: string;
  credentialName: string;
  /** SHA-256 of the bearer token; used only as the MCP response envelope key. */
  credentialTransportKey: string;
}

export function encryptMcpSecretEnvelope(value: string, transportKey: string): string {
  const key = createHash("sha256").update(`humanthread:mcp-envelope:${transportKey}`).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
}

function createMcpToken(): string {
  return `ht_mcp_${randomBytes(18).toString("hex")}`;
}

export function hashMcpToken(token: string): string {
  return createHash("sha256").update(token.trim()).digest("hex");
}

function parseBearerToken(headerValue: string | null): string {
  if (!headerValue) {
    throw new Error("Missing MCP authorization token");
  }

  const match = headerValue.match(/^Bearer\s+(.+)$/u);

  if (!match?.[1]?.trim()) {
    throw new Error("Missing MCP authorization token");
  }

  return match[1].trim();
}

function defaultIssueDependencies(): IssueMcpCredentialDependencies {
  return {
    createToken: createMcpToken,
    createCredential: async ({ userId, name, tokenHash, status }) => {
      const created = await prisma.mcpCredential.create({
        data: {
          id: `mcp_${randomUUID()}`,
          userId,
          name,
          tokenHash,
          status,
        },
        select: {
          id: true,
          userId: true,
          name: true,
        },
      });

      return created;
    },
  };
}

function defaultAuthenticateDependencies(): AuthenticateMcpRequestDependencies {
  return {
    loadCredential: async ({ tokenHash }) =>
      prisma.mcpCredential.findFirst({
        where: {
          tokenHash,
        },
        select: {
          id: true,
          userId: true,
          name: true,
          status: true,
          revokedAt: true,
          tokenHash: true,
          user: {
            select: {
              id: true,
              status: true,
            },
          },
        },
      }),
    touchCredential: async ({ credentialId, now }) => {
      await prisma.mcpCredential.update({
        where: {
          id: credentialId,
        },
        data: {
          lastUsedAt: now,
        },
      });
    },
  };
}

export async function issueMcpCredential(
  input: {
    userId: string;
    name: string;
  },
  dependencies: Partial<IssueMcpCredentialDependencies> = {},
): Promise<McpCredentialView> {
  const resolved = {
    ...defaultIssueDependencies(),
    ...dependencies,
  };
  const name = input.name.trim() || "Codex";
  const token = resolved.createToken();
  const tokenHash = hashMcpToken(token);
  const credential = await resolved.createCredential({
    userId: input.userId,
    name,
    tokenHash,
    status: "active",
  });

  return {
    credentialId: credential.id,
    userId: credential.userId,
    name: credential.name,
    token,
  };
}

export async function authenticateMcpRequest(
  input: AuthenticateMcpRequestInput,
  dependencies: Partial<AuthenticateMcpRequestDependencies> = {},
): Promise<AuthenticatedMcpContext> {
  const resolved = {
    ...defaultAuthenticateDependencies(),
    ...dependencies,
  };
  const token = parseBearerToken(input.authorizationHeader);
  const credential = await resolved.loadCredential({
    tokenHash: hashMcpToken(token),
  });

  if (!credential) {
    throw new Error("Invalid MCP authorization token");
  }

  if (credential.status !== "active" || credential.revokedAt) {
    throw new Error("MCP credential is revoked");
  }

  if (!credential.user || credential.user.status !== "active") {
    throw new Error("MCP user is unavailable");
  }

  await resolved.touchCredential({
    credentialId: credential.id,
    now: new Date(),
  });

  return {
    credentialId: credential.id,
    userId: credential.userId,
    credentialName: credential.name,
    credentialTransportKey: hashMcpToken(token),
  };
}
