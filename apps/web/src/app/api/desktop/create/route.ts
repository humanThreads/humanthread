import { randomUUID } from "node:crypto";
import { z } from "zod";

import {
  createDesktopCorsPreflightResponse,
  createDesktopJsonResponse,
} from "../../../../lib/desktop/desktop-cors";
import { resolveDesktopReadContext } from "@/lib/desktop/desktop-read-models";
import { createUserTask } from "@/lib/tasks/task-commands";
import { createWorkbenchSpaceDocument } from "@/lib/workbench/workbench-documents";
import { createWorkbenchProject } from "@/lib/workbench/workbench-project-commands";
import { initializeProjectKnowledgeAfterCreate } from "@/lib/workbench/project-knowledge-bootstrap";

const METHODS = ["OPTIONS", "POST"] as const;
const baseCreateSchema = z.object({
  spaceKey: z.string().trim().min(1).max(160),
});
const createSchema = z.discriminatedUnion("kind", [
  baseCreateSchema.extend({
    kind: z.literal("task"),
    commandId: z.string().trim().min(1).max(128),
    title: z.string().trim().min(1).max(191),
  }),
  baseCreateSchema.extend({
    kind: z.literal("project"),
    name: z.string().trim().min(1).max(191),
    objective: z.string().trim().min(1).max(10_000),
  }),
  baseCreateSchema.extend({
    kind: z.literal("document"),
    title: z.string().trim().min(1).max(191),
  }),
]);

export function OPTIONS(request: Request) {
  return createDesktopCorsPreflightResponse(request, METHODS);
}

function authorizedContextRequest(request: Request, spaceKey: string): Request {
  const url = new URL(request.url);
  url.search = new URLSearchParams({ space: spaceKey }).toString();
  return new Request(url, { headers: request.headers });
}

function documentPath(title: string): string {
  const stem = title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\\/?#]+/gu, "-")
    .replace(/\s+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80) || "document";
  return `${stem}-${randomUUID().slice(0, 8)}.md`;
}

function commandErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}

function commandErrorStatus(error: unknown, message: string): number {
  const code = commandErrorCode(error);
  if (message === "Workbench API authentication required") return 401;
  if (code === "validation_failed") return 400;
  if (code === "authorization_denied") return 403;
  if (code === "not_found") return 404;
  if (code === "conflict") return 409;
  if (/access denied|write access|authorization_denied/iu.test(message)) return 403;
  if (/conflict|unique/iu.test(message)) return 409;
  return 500;
}

function responseErrorCode(status: number, error: unknown): string {
  const code = commandErrorCode(error);
  if (code) return code;
  if (status === 400) return "validation_failed";
  if (status === 401) return "authentication_required";
  if (status === 403) return "authorization_denied";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  return "internal_error";
}

export async function POST(request: Request) {
  try {
    const body = createSchema.parse(await request.json());
    const context = await resolveDesktopReadContext(
      authorizedContextRequest(request, body.spaceKey),
    );
    let result: unknown;

    if (body.kind === "task") {
      result = await createUserTask({
        actor: { type: "user", id: context.actor.userId },
        commandId: body.commandId,
        correlationId: `desktop:create:${body.commandId}`,
        payload: { spaceId: context.space.id, title: body.title },
      });
    } else if (body.kind === "project") {
      result = await createWorkbenchProject({
        userId: context.actor.userId,
        spaceId: context.space.id,
        name: body.name,
        objective: body.objective,
        managerUserId: context.actor.userId,
        dependencies: {
          assertCanWriteSpace: (await import("@humanthread/db")).assertCanWriteSpace,
          db: (await import("@humanthread/db")).prisma as never,
          initializeKnowledge: initializeProjectKnowledgeAfterCreate,
        },
      });
    } else {
      result = await createWorkbenchSpaceDocument({
        userId: context.actor.userId,
        spaceId: context.space.id,
        title: body.title,
        path: documentPath(body.title),
        contentMarkdown: `# ${body.title}\n`,
        source: "web",
      });
    }

    return createDesktopJsonResponse(
      request,
      METHODS,
      { ok: true, data: { kind: body.kind, result } },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createDesktopJsonResponse(
        request,
        METHODS,
        { ok: false, code: "validation_failed", error: "Invalid desktop create request" },
        { status: 400 },
      );
    }
    const message = error instanceof Error ? error.message : "Desktop create failed";
    const status = commandErrorStatus(error, message);
    return createDesktopJsonResponse(
      request,
      METHODS,
      {
        ok: false,
        code: responseErrorCode(status, error),
        error: status === 500 ? "Desktop create failed" : message,
      },
      { status },
    );
  }
}
