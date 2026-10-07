import { prisma } from "@humanthread/db";

import {
  readWorkflowTimeline,
  type WorkflowTimelineItem,
  type WorkflowTimelineResult,
} from "./workflow-timeline-query";

const MAX_EXPORT_ITEMS = 5_000;

interface ExportDependencies {
  readWorkflowTimeline: typeof readWorkflowTimeline;
  loadRun(input: { loopRunId: string }): Promise<{ projectId: string | null; definitionVersion: number | null } | null>;
}

const DEFAULTS: ExportDependencies = {
  readWorkflowTimeline,
  loadRun: async ({ loopRunId }) => {
    const run = await prisma.loopRun.findFirst({
      where: { id: loopRunId, engineKind: "graph_v1" },
      select: { projectId: true, loopVersion: { select: { versionNumber: true } } },
    });
    return run ? { projectId: run.projectId, definitionVersion: run.loopVersion?.versionNumber ?? null } : null;
  },
};

export async function exportWorkflowTimeline(
  input: {
    userId: string;
    loopRunId: string;
    format: "json" | "markdown";
    filters: Omit<Parameters<typeof readWorkflowTimeline>[0], "userId" | "loopRunId" | "cursor" | "limit">;
  },
  overrides: Partial<ExportDependencies> = {},
) {
  const dependencies = { ...DEFAULTS, ...overrides };
  const run = await dependencies.loadRun({ loopRunId: input.loopRunId });
  if (!run?.projectId) throw exportError("not_found", "Graph LoopRun not found");

  const items: WorkflowTimelineItem[] = [];
  let cursor: string | undefined;
  let filterSnapshot: Record<string, unknown> = {};
  do {
    const page: WorkflowTimelineResult = await dependencies.readWorkflowTimeline({
      userId: input.userId,
      loopRunId: input.loopRunId,
      ...input.filters,
      limit: 200,
      ...(cursor ? { cursor } : {}),
    });
    filterSnapshot = page.filters;
    items.push(...page.items);
    if (items.length > MAX_EXPORT_ITEMS) throw exportError("export_too_large", "Workflow timeline export is too large");
    if (!page.nextCursor) break;
    if (page.nextCursor === cursor) throw exportError("validation_failed", "Workflow timeline cursor did not advance");
    cursor = page.nextCursor;
  } while (true);

  const header = {
    schemaVersion: 1,
    loopRunId: input.loopRunId,
    projectId: run.projectId,
    definitionVersion: run.definitionVersion,
    generatedAt: new Date().toISOString(),
    filters: filterSnapshot,
  };
  if (input.format === "json") {
    return {
      contentType: "application/json",
      fileName: `loop-run-${safeFilePart(input.loopRunId)}-timeline.json`,
      body: JSON.stringify({ ...header, items }),
    };
  }
  return {
    contentType: "text/markdown",
    fileName: `loop-run-${safeFilePart(input.loopRunId)}-timeline.md`,
    body: renderMarkdown(header, items),
  };
}

function renderMarkdown(header: Record<string, unknown>, items: WorkflowTimelineItem[]) {
  const lines = [
    "# LoopRun Timeline",
    "",
    `- LoopRun: ${header.loopRunId}`,
    `- Project: ${header.projectId}`,
    `- Definition version: ${header.definitionVersion ?? "unknown"}`,
    `- Generated: ${header.generatedAt}`,
    `- Filters: ${JSON.stringify(header.filters)}`,
    "",
    "| Time | Actor | Kind | Status | Summary |",
    "| --- | --- | --- | --- | --- |",
    ...items.map((item) => [
      item.occurredAt,
      `${item.actorType}:${item.actorId}`,
      item.kind,
      item.status ?? "",
      item.summary,
    ].map(markdownCell).join(" | ").replace(/^/, "| ").concat(" |")),
  ];
  return lines.join("\n") + "\n";
}

function markdownCell(value: string) {
  return value.replace(/[|\r\n]/gu, " ");
}

function safeFilePart(value: string) {
  return value.replace(/[^A-Za-z0-9_-]/gu, "_").slice(0, 96) || "run";
}

function exportError(code: "not_found" | "export_too_large" | "validation_failed", message: string) {
  return Object.assign(new Error(message), { code });
}
