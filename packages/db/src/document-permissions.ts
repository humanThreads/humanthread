import { createHash } from "node:crypto";
import { prisma } from "./prisma";

export const DOCUMENT_PERMISSIONS = ["read", "edit", "manage"] as const;
export type DocumentPermission = (typeof DOCUMENT_PERMISSIONS)[number];

export function permissionRank(permission: DocumentPermission) {
  return DOCUMENT_PERMISSIONS.indexOf(permission);
}

export function effectiveDocumentPermission(input: {
  base: DocumentPermission;
  inherited?: DocumentPermission[];
  explicit?: DocumentPermission | null;
}) {
  return [...input.inherited ?? [], input.base, ...(input.explicit ? [input.explicit] : [])]
    .sort((left, right) => permissionRank(right) - permissionRank(left))[0] ?? "read";
}

export function buildDocumentPermissionId(targetId: string, userId: string) {
  return createHash("md5").update(["document-permission", targetId, userId].join("\0")).digest("hex");
}

export function isDocumentPermission(value: string): value is DocumentPermission {
  return (DOCUMENT_PERMISSIONS as readonly string[]).includes(value);
}

type PermissionRow = { id: string; userDigest: string; permission: string; revokedAt: Date | null };

function digest(value: string) {
  return createHash("md5").update(value).digest("hex");
}

export function buildDocumentPermissionTargetDigest(targetId: string) {
  return digest(targetId);
}

export async function listDocumentPermissions(input: {
  spaceId: string;
  documentId?: string;
  directoryId?: string;
  db?: { documentPermission: { findMany(args: unknown): Promise<PermissionRow[]> } };
}) {
  if (!input.documentId && !input.directoryId) throw new Error("Document permission target is required");
  const db = input.db ?? (prisma as unknown as { documentPermission: { findMany(args: unknown): Promise<PermissionRow[]> } });
  return db.documentPermission.findMany({
    where: {
      spaceDigest: digest(input.spaceId),
      ...(input.documentId ? { documentDigest: digest(input.documentId) } : { directoryDigest: digest(input.directoryId!) }),
      revokedAt: null,
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function grantDocumentPermission(input: {
  spaceId: string;
  documentId?: string;
  directoryId?: string;
  userId: string;
  permission: DocumentPermission;
  createdById: string;
  db?: { documentPermission: { upsert(args: unknown): Promise<unknown> } };
}) {
  if (!input.documentId && !input.directoryId) throw new Error("Document permission target is required");
  const db = input.db ?? (prisma as unknown as { documentPermission: { upsert(args: unknown): Promise<unknown> } });
  const target = input.documentId ?? input.directoryId!;
  return db.documentPermission.upsert({
    where: { spaceDigest_documentDigest_directoryDigest_userDigest: {
      spaceDigest: digest(input.spaceId),
      documentDigest: input.documentId ? digest(input.documentId) : null,
      directoryDigest: input.directoryId ? digest(input.directoryId) : null,
      userDigest: digest(input.userId),
    } },
    create: {
      id: buildDocumentPermissionId(target, input.userId),
      spaceDigest: digest(input.spaceId),
      documentDigest: input.documentId ? digest(input.documentId) : null,
      directoryDigest: input.directoryId ? digest(input.directoryId) : null,
      userDigest: digest(input.userId),
      permission: input.permission,
      createdByDigest: digest(input.createdById),
    },
    update: { permission: input.permission, revokedAt: null, createdByDigest: digest(input.createdById) },
  });
}

export async function revokeDocumentPermission(input: {
  permissionId: string;
  db?: { documentPermission: { update(args: unknown): Promise<unknown> } };
}) {
  const db = input.db ?? (prisma as unknown as { documentPermission: { update(args: unknown): Promise<unknown> } });
  return db.documentPermission.update({ where: { id: input.permissionId }, data: { revokedAt: new Date() } });
}

export async function assertCanManageDocumentPermission(input: {
  userId: string;
  spaceId: string;
  db?: { companyMember: { findFirst(args: unknown): Promise<{ role: string } | null> } };
}) {
  const db = input.db ?? (prisma as unknown as { companyMember: { findFirst(args: unknown): Promise<{ role: string } | null> } });
  const membership = await db.companyMember.findFirst({
    where: { userId: input.userId, companyId: input.spaceId.replace(/^space:company:/u, ""), status: "active", role: { in: ["owner", "admin"] } },
    select: { role: true },
  });
  if (!membership) throw new Error("Document permission management is required");
  return membership;
}
