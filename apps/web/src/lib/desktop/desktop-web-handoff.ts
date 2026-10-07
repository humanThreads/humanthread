import { createHash, randomBytes, randomUUID } from "node:crypto";

import { prisma } from "../../../../../packages/db/src/index";
import {
  getWorkbenchCompanySettingsContext,
  getWorkbenchSettingsContext,
} from "../workbench/workbench-settings-context";

const HANDOFF_TTL_MS = 60_000;
const SETTINGS_TARGETS = new Set([
  "/settings",
  "/settings/account",
  "/settings/security",
  "/settings/devices",
  "/settings/mcp",
  "/settings/companies",
  "/settings/admin",
]);
const COMPANY_TARGET = /^\/companies\/([A-Za-z0-9_-]+)(?:\/(members|integrations))?$/u;

interface DesktopWebHandoffStoredRecord {
  id: string;
  userId: string;
  sessionId: string;
  codeHash: string;
  targetPath: string;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
}

export interface DesktopWebHandoffRecord extends DesktopWebHandoffStoredRecord {
  userEmail: string;
}

export interface DesktopWebHandoffRepository {
  create(input: DesktopWebHandoffStoredRecord): Promise<void>;
  findByCodeHash(codeHash: string): Promise<DesktopWebHandoffRecord | null>;
  consume(input: {
    id: string;
    codeHash: string;
    now: Date;
  }): Promise<DesktopWebHandoffRecord | null>;
}

interface DesktopWebHandoffDependencies {
  repository: DesktopWebHandoffRepository;
  now: () => Date;
  createCode: () => string;
  createId: () => string;
  authorizeTarget(input: { userId: string; targetPath: string }): Promise<void>;
}

function toHandoffRecord(record: {
  id: string;
  userId: string;
  sessionId: string;
  codeHash: string;
  targetPath: string;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
  user: { email: string | null };
}): DesktopWebHandoffRecord {
  if (!record.user.email) {
    throw new Error("Desktop Web handoff account email is unavailable");
  }
  return {
    id: record.id,
    userId: record.userId,
    userEmail: record.user.email,
    sessionId: record.sessionId,
    codeHash: record.codeHash,
    targetPath: record.targetPath,
    expiresAt: record.expiresAt,
    consumedAt: record.consumedAt,
    createdAt: record.createdAt,
  };
}

function defaultRepository(): DesktopWebHandoffRepository {
  const selection = {
    id: true,
    userId: true,
    sessionId: true,
    codeHash: true,
    targetPath: true,
    expiresAt: true,
    consumedAt: true,
    createdAt: true,
    user: { select: { email: true } },
  } as const;
  return {
    async create(input) {
      await prisma.desktopWebHandoff.create({ data: input });
    },
    async findByCodeHash(codeHash) {
      const record = await prisma.desktopWebHandoff.findUnique({
        where: { codeHash },
        select: selection,
      });
      return record ? toHandoffRecord(record) : null;
    },
    consume: ({ id, codeHash, now }) => prisma.$transaction(async (transaction) => {
      const result = await transaction.desktopWebHandoff.updateMany({
        where: {
          id,
          codeHash,
          consumedAt: null,
          expiresAt: { gt: now },
        },
        data: { consumedAt: now },
      });
      if (result.count !== 1) return null;
      const record = await transaction.desktopWebHandoff.findUnique({
        where: { id },
        select: selection,
      });
      return record ? toHandoffRecord(record) : null;
    }),
  };
}

export function hashDesktopWebHandoffCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function normalizeAllowedTarget(targetPath: string): string {
  const normalized = targetPath.trim();
  let parsed: URL;
  try {
    parsed = new URL(normalized, "https://humanthread.invalid");
  } catch {
    throw new Error("Desktop Web handoff target is not allowed");
  }
  if (
    !normalized.startsWith("/") ||
    parsed.origin !== "https://humanthread.invalid" ||
    parsed.pathname !== normalized ||
    parsed.search ||
    parsed.hash ||
    (!SETTINGS_TARGETS.has(normalized) && !COMPANY_TARGET.test(normalized))
  ) {
    throw new Error("Desktop Web handoff target is not allowed");
  }
  return normalized;
}

export async function assertDesktopWebHandoffTargetAccess(input: {
  userId: string;
  targetPath: string;
}): Promise<void> {
  const companyMatch = input.targetPath.match(COMPANY_TARGET);
  if (companyMatch) {
    const companyId = companyMatch[1];
    if (!companyId) throw new Error("Desktop Web handoff target access denied");
    const context = await getWorkbenchCompanySettingsContext({
      userId: input.userId,
      companyId,
    });
    if (!context) throw new Error("Desktop Web handoff target access denied");
    return;
  }

  const context = await getWorkbenchSettingsContext({ userId: input.userId });
  if (input.targetPath === "/settings/admin" && !context.isSiteAdmin) {
    throw new Error("Desktop Web handoff target access denied");
  }
}

function dependenciesWith(
  overrides: Partial<DesktopWebHandoffDependencies>,
): DesktopWebHandoffDependencies {
  return {
    repository: overrides.repository ?? defaultRepository(),
    now: overrides.now ?? (() => new Date()),
    createCode: overrides.createCode ?? (() => randomBytes(32).toString("base64url")),
    createId: overrides.createId ?? (() => `desktop_handoff_${randomUUID()}`),
    authorizeTarget: overrides.authorizeTarget ?? assertDesktopWebHandoffTargetAccess,
  };
}

export async function issueDesktopWebHandoff(
  input: { userId: string; sessionId: string; targetPath: string },
  dependencyOverrides: Partial<DesktopWebHandoffDependencies> = {},
): Promise<{ code: string; targetPath: string; expiresAt: Date }> {
  const dependencies = dependenciesWith(dependencyOverrides);
  const targetPath = normalizeAllowedTarget(input.targetPath);
  await dependencies.authorizeTarget({ userId: input.userId, targetPath });
  const now = dependencies.now();
  const code = dependencies.createCode();
  if (!code.trim()) throw new Error("Desktop Web handoff code generation failed");
  const expiresAt = new Date(now.getTime() + HANDOFF_TTL_MS);
  await dependencies.repository.create({
    id: dependencies.createId(),
    userId: input.userId,
    sessionId: input.sessionId,
    codeHash: hashDesktopWebHandoffCode(code),
    targetPath,
    expiresAt,
    consumedAt: null,
    createdAt: now,
  });
  return { code, targetPath, expiresAt };
}

export async function consumeDesktopWebHandoff(
  code: string,
  dependencyOverrides: Partial<DesktopWebHandoffDependencies> = {},
): Promise<DesktopWebHandoffRecord> {
  const normalizedCode = code.trim();
  if (!normalizedCode) throw new Error("Desktop Web handoff code is required");
  const dependencies = dependenciesWith(dependencyOverrides);
  const codeHash = hashDesktopWebHandoffCode(normalizedCode);
  const record = await dependencies.repository.findByCodeHash(codeHash);
  if (!record) throw new Error("Desktop Web handoff code is invalid");
  const now = dependencies.now();
  if (record.consumedAt) {
    throw new Error("Desktop Web handoff has already been consumed");
  }
  if (record.expiresAt <= now) {
    throw new Error("Desktop Web handoff has expired");
  }
  const consumed = await dependencies.repository.consume({ id: record.id, codeHash, now });
  if (!consumed) {
    throw new Error("Desktop Web handoff has already been consumed");
  }
  return consumed;
}
