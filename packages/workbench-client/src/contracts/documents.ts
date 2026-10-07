import { z } from "zod";

const isoDateTimeSchema = z.iso.datetime();
const documentRouteSchema = z.string().regex(/^\/documents(?:[/?]|$)/u);
const documentSourceSchema = z.enum(["web", "desktop", "agent", "mcp", "system"]);

const desktopDocumentDirectorySchema = z.object({
  id: z.string().min(1),
  parentId: z.string().min(1).nullable(),
  name: z.string().min(1),
  path: z.string().min(1),
  sortOrder: z.number().int(),
}).strict();

const desktopDocumentTreeItemSchema = z.object({
  id: z.string().min(1),
  directoryId: z.string().min(1).nullable(),
  title: z.string().min(1),
  path: z.string().min(1),
  sortOrder: z.number().int(),
  route: documentRouteSchema,
}).strict();

export const desktopDocumentTreeResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    groups: z.array(z.object({
      key: z.string().min(1),
      label: z.string().min(1),
      projectId: z.string().min(1).nullable(),
      canWrite: z.boolean(),
      directories: z.array(desktopDocumentDirectorySchema),
      documents: z.array(desktopDocumentTreeItemSchema),
    }).strict()),
    trash: z.array(z.object({
      id: z.string().min(1),
      groupKey: z.string().min(1),
      directoryId: z.string().min(1).nullable(),
      title: z.string().min(1),
      path: z.string().min(1),
      sortOrder: z.number().int(),
      deletedAt: isoDateTimeSchema,
    }).strict()),
  }).strict(),
}).strict();

export const desktopDocumentDetailResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    detail: z.object({
      id: z.string().min(1),
      projectId: z.string().min(1).nullable(),
      title: z.string().min(1),
      path: z.string().min(1),
      contentMarkdown: z.string(),
      version: z.number().int().positive(),
      createdAt: isoDateTimeSchema,
      updatedAt: isoDateTimeSchema,
      capabilities: z.object({ edit: z.boolean() }).strict(),
    }).strict(),
  }).strict(),
}).strict();

export const desktopDocumentRevisionsResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    revisions: z.array(z.object({
      id: z.string().min(1),
      documentId: z.string().min(1),
      version: z.number().int().positive(),
      contentMarkdown: z.string(),
      source: documentSourceSchema,
      createdAt: isoDateTimeSchema,
      createdById: z.string().min(1),
    }).strict()),
  }).strict(),
}).strict();

export const desktopDocumentUpdateRequestSchema = z.object({
  commandId: z.string().trim().min(1).max(128),
  expectedVersion: z.number().int().positive(),
  title: z.string().trim().min(1).max(191),
  contentMarkdown: z.string(),
}).strict();

export const desktopDocumentUpdateResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    document: z.object({
      id: z.string().min(1),
      version: z.number().int().positive(),
    }).strict(),
  }).strict(),
}).strict();

export const desktopDocumentConflictResponseSchema = z.object({
  ok: z.literal(false),
  code: z.literal("version_conflict"),
  error: z.string().min(1),
  currentVersion: z.number().int().positive(),
}).strict();

export type DesktopDocumentTreeResponse = z.infer<typeof desktopDocumentTreeResponseSchema>;
export type DesktopDocumentDetailResponse = z.infer<typeof desktopDocumentDetailResponseSchema>;
export type DesktopDocumentRevisionsResponse = z.infer<typeof desktopDocumentRevisionsResponseSchema>;
export type DesktopDocumentUpdateRequest = z.infer<typeof desktopDocumentUpdateRequestSchema>;
export type DesktopDocumentUpdateResponse = z.infer<typeof desktopDocumentUpdateResponseSchema>;
export type DesktopDocumentDetail = DesktopDocumentDetailResponse["data"]["detail"];
export type DesktopDocumentRevision = DesktopDocumentRevisionsResponse["data"]["revisions"][number];
