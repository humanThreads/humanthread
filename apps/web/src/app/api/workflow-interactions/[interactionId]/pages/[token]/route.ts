import { NextResponse } from "next/server";

import { getWorkflowInteraction } from "@humanthread/db";
import { assertCanReadProject } from "@humanthread/db";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import {
  readTemporaryReviewPage,
  TemporaryReviewPageError,
} from "@/lib/workflow-interaction/temporary-review-page";

export const runtime = "nodejs";

type Context = { params: Promise<{ interactionId: string; token: string }> };

/**
 * Serves an Agent-supplied review page to a project reader.
 *
 * The page is not a platform artifact: it is held only by the short-lived
 * proxy, scoped to this interaction, and served with the same lockdown policy
 * as the artifact route so it cannot navigate, post or load remote resources.
 */
export async function GET(request: Request, context: Context): Promise<Response> {
  let actor: { userId: string };
  try {
    actor = await resolveWorkbenchApiActor(request);
  } catch {
    return NextResponse.json({ ok: false, errorCode: "unauthorized" }, { status: 401 });
  }

  const params = await context.params;
  let interactionId: string;
  let token: string;
  try {
    interactionId = decodeRouteValue(params.interactionId, "interactionId");
    token = decodeRouteValue(params.token, "token");
  } catch {
    return NextResponse.json({ ok: false, errorCode: "validation_failed" }, { status: 400 });
  }
  if (!/^[a-f0-9]{32}$/u.test(token)) {
    return NextResponse.json({ ok: false, errorCode: "validation_failed" }, { status: 400 });
  }

  try {
    const interaction = await getWorkflowInteraction({ id: interactionId });
    if (!interaction) {
      return NextResponse.json({ ok: false, errorCode: "temporary_review_page_not_found" }, { status: 404 });
    }
    await assertCanReadProject({ userId: actor.userId, projectId: interaction.projectId });
    const page = readTemporaryReviewPage({ token, interactionId });
    return new Response(page.html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-length": String(page.byteSize),
        "content-disposition": "inline",
        // Temporary pages must never be cached: the token is the capability.
        "cache-control": "no-store, max-age=0",
        "x-content-type-options": "nosniff",
        "cross-origin-resource-policy": "same-origin",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; sandbox; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
      },
    });
  } catch (error) {
    if (error instanceof TemporaryReviewPageError) {
      const status = error.code === "temporary_review_page_expired" ? 410 : 404;
      // This URL renders inside an iframe, so answer with a readable page
      // rather than JSON the human would see as raw text.
      return new Response(placeholderPage(
        error.code === "temporary_review_page_expired"
          ? "该审阅页已过期"
          : "该审阅页不可用",
        error.code === "temporary_review_page_expired"
          ? "临时审阅页只在有限时间内保留，请联系 Agent 重新生成。"
          : "临时审阅页未绑定到本次交互，或服务已重启。请联系 Agent 重新生成。",
      ), {
        status,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store, max-age=0",
          "x-content-type-options": "nosniff",
        },
      });
    }
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "unauthorized" || code === "authorization_denied") {
      return NextResponse.json({ ok: false, errorCode: "authorization_denied" }, { status: 403 });
    }
    return NextResponse.json({ ok: false, errorCode: "validation_failed" }, { status: 400 });
  }
}

function placeholderPage(title: string, detail: string): string {
  const escape = (value: string) => value.replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character] ?? character);
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${escape(title)}</title>`
    + "<style>body{margin:0;padding:24px;font:14px/1.7 system-ui,sans-serif;color:#57606a}"
    + "strong{display:block;margin-bottom:6px;color:#24292f;font-size:15px}</style>"
    + `<body><strong>${escape(title)}</strong>${escape(detail)}</body></html>`;
}

function decodeRouteValue(value: string, name: string): string {
  const decoded = decodeURIComponent(value);
  if (!decoded || decoded.length > 128 || decoded !== decoded.trim()) {
    throw new Error(`${name} is invalid`);
  }
  return decoded;
}
