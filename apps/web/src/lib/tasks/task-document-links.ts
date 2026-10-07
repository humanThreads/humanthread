import { createHash } from "node:crypto";
import { assertCanEditTask, assertCanReadTask, prisma } from "../../../../../packages/db/src/index";

type TaskDb = { task: { findUnique(args: unknown): Promise<unknown> }; document?: { findMany?(args: unknown): Promise<unknown[]>; findUnique?(args: unknown): Promise<unknown> }; taskDocumentLink?: { create?(args: unknown): Promise<unknown>; deleteMany?(args: unknown): Promise<{ count: number }> }; taskActivity?: { create?(args: unknown): Promise<unknown> }; assertCanReadTask?: typeof assertCanReadTask; assertCanEditTask?: typeof assertCanEditTask };
type ScopedTask = { id?: string; projectId: string | null; spaceId: string };
type ScopedDocument = { id: string; spaceId: string };

export async function listLinkableDocuments(input: { userId: string; taskId: string; query: string; db?: TaskDb }) {
  const db = input.db ?? prisma as unknown as TaskDb;
  await (db.assertCanReadTask ?? assertCanReadTask)({ userId: input.userId, taskId: input.taskId });
  const task = await db.task.findUnique({ where: { id: input.taskId }, select: { projectId: true, spaceId: true } }) as ScopedTask | null;
  if (!task) throw new Error("Task not found");
  if (!db.document?.findMany) throw new Error("Document search is unavailable");
  return db.document.findMany({ where: { spaceId: task.spaceId, ...(task.projectId ? { OR: [{ projectId: task.projectId }, { projectId: null }] } : {}), title: { contains: input.query.trim() } }, select: { id: true, title: true, path: true, version: true }, orderBy: { updatedAt: "desc" }, take: 20 });
}

export async function linkTaskDocument(input: { userId: string; taskId: string; documentId: string; db?: TaskDb }) {
  const db = input.db ?? prisma as unknown as TaskDb;
  await (db.assertCanEditTask ?? assertCanEditTask)({ userId: input.userId, taskId: input.taskId });
  if (!db.document?.findUnique || !db.taskDocumentLink?.create) throw new Error("Document linking is unavailable");
  const [task, document] = await Promise.all([db.task.findUnique({ where: { id: input.taskId }, select: { id: true, spaceId: true } }) as Promise<ScopedTask | null>, db.document.findUnique({ where: { id: input.documentId }, select: { id: true, spaceId: true } }) as Promise<ScopedDocument | null>]);
  if (!task || !document || task.spaceId !== document.spaceId) throw new Error("Document is not accessible");
  const result = await db.taskDocumentLink.create({ data: { id: linkId(input.taskId, input.documentId), taskId: input.taskId, documentId: input.documentId, linkedById: input.userId } });
  if (db.taskActivity?.create) await db.taskActivity.create({ data: { id: activityId("linked", input.taskId, input.documentId), taskId: input.taskId, actorType: "user", actorId: input.userId, type: "document_linked", message: "已关联文档", payload: { documentId: input.documentId } } });
  return result;
}

export async function unlinkTaskDocument(input: { userId: string; taskId: string; documentId: string; db?: TaskDb }) {
  const db = input.db ?? prisma as unknown as TaskDb;
  await (db.assertCanEditTask ?? assertCanEditTask)({ userId: input.userId, taskId: input.taskId });
  if (!db.taskDocumentLink?.deleteMany) throw new Error("Document unlinking is unavailable");
  const result = await db.taskDocumentLink.deleteMany({ where: { taskId: input.taskId, documentId: input.documentId } });
  if (result.count === 1 && db.taskActivity?.create) await db.taskActivity.create({ data: { id: activityId("unlinked", input.taskId, input.documentId), taskId: input.taskId, actorType: "user", actorId: input.userId, type: "document_unlinked", message: "已解除文档关联", payload: { documentId: input.documentId } } });
  return { removed: result.count === 1 };
}

function linkId(taskId: string, documentId: string) { return createHash("md5").update(`task-document:${taskId}:${documentId}`).digest("hex"); }
function activityId(action: string, taskId: string, documentId: string) { return createHash("md5").update(`task-document:${action}:${taskId}:${documentId}`).digest("hex"); }
