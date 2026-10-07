"use client";

import { useState } from "react";

import { EmptyState, StatusPill, WorkbenchButton } from "../workbench-ui";

export interface KnowledgeReviewItem {
  id: string;
  batchId: string;
  ordinal: number;
  stableKey: string;
  changeType: string;
  sourceType: string;
  entryType: string;
  title: string;
  summary: string;
  confidence: number;
  tags: string[];
  decision: string | null;
  decisionReason: string | null;
  publishedVersion: number | null;
}

export interface KnowledgeReviewBatch {
  batchId: string;
  jobId: string;
  submissionId: string;
  status: string;
  progress: number;
  receivedAt: string;
  updatedAt: string;
  items: KnowledgeReviewItem[];
}

interface KnowledgeReviewQueueApi {
  decide(batchId: string, input: { decision: "approve" | "reject"; itemIds?: string[]; reason?: string }): Promise<unknown>;
}

const STATUS_LABELS: Record<string, string> = {
  review_required: "待审核",
  archiving: "归档中",
  searchable: "可检索",
  rejected: "已拒绝",
};

export function KnowledgeReviewQueue({
  projectId,
  initialBatches,
  api = createBrowserApi(projectId),
}: {
  projectId: string;
  initialBatches: KnowledgeReviewBatch[];
  api?: KnowledgeReviewQueueApi;
}) {
  const [batches, setBatches] = useState(initialBatches);
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function decide(batchId: string, decision: "approve" | "reject") {
    setPending(`${batchId}:${decision}`);
    setMessage(null);
    try {
      await api.decide(batchId, {
        decision,
        ...(decision === "reject" ? { reason: "人工审核拒绝" } : {}),
      });
      setBatches((current) => current.filter((batch) => batch.batchId !== batchId));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "知识审核操作失败，请重试");
    } finally {
      setPending(null);
    }
  }

  if (batches.length === 0) {
    return <EmptyState title="暂无待审核知识" description="项目提交的候选批次需要人工审核时会显示在这里。" />;
  }

  return (
    <div className="grid gap-3">
      {message ? <p role="alert" className="text-xs text-[#cf222e]">{message}</p> : null}
      {batches.map((batch) => {
        const reviewable = batch.items.filter((item) => item.decision === "review_required");
        const approving = pending === `${batch.batchId}:approve`;
        const rejecting = pending === `${batch.batchId}:reject`;
        return (
          <section key={batch.batchId} className="grid gap-3 rounded-lg border border-[#d0d7de] bg-white p-4">
            <header className="grid gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="mr-auto text-sm font-semibold text-[#24292f]">知识候选批次</h3>
                <StatusPill tone="warning">{STATUS_LABELS[batch.status] ?? batch.status}</StatusPill>
                <span className="text-xs text-[#57606a]">进度 {batch.progress}%</span>
              </div>
              <dl className="grid gap-1 text-xs text-[#57606a]">
                <div className="flex flex-wrap gap-1"><dt className="font-medium">batchId</dt><dd className="break-all font-mono">{batch.batchId}</dd></div>
                <div className="flex flex-wrap gap-1"><dt className="font-medium">jobId</dt><dd className="break-all font-mono">{batch.jobId}</dd></div>
                <div className="flex flex-wrap gap-1"><dt className="font-medium">submissionId</dt><dd className="break-all font-mono">{batch.submissionId}</dd></div>
              </dl>
            </header>

            <ul className="grid gap-2">
              {batch.items.map((item) => (
                <li key={item.id} className="grid gap-1 rounded-md border border-[#eaeef2] p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="mr-auto text-sm font-medium text-[#24292f]">{item.title}</span>
                    <StatusPill tone="blue">{item.entryType}</StatusPill>
                    <span className="text-xs text-[#57606a]">置信度 {(item.confidence * 100).toFixed(0)}%</span>
                  </div>
                  <p className="break-all font-mono text-[11px] text-[#57606a]">{item.stableKey}</p>
                  <p className="text-xs leading-5 text-[#57606a]">{item.summary}</p>
                  {item.decisionReason ? (
                    <p className="text-[11px] leading-5 text-[#9a6700]">审核原因：{item.decisionReason}</p>
                  ) : null}
                </li>
              ))}
            </ul>

            <div className="flex flex-wrap items-center gap-2 border-t border-[#d8dee4] pt-3">
              <span className="mr-auto text-xs text-[#57606a]">待审核 {reviewable.length} 条，共 {batch.items.length} 条</span>
              <WorkbenchButton
                type="button"
                size="small"
                variant="primary"
                disabled={pending !== null || reviewable.length === 0}
                onClick={() => void decide(batch.batchId, "approve")}
              >
                {approving ? "通过中" : "全部通过"}
              </WorkbenchButton>
              <WorkbenchButton
                type="button"
                size="small"
                disabled={pending !== null || reviewable.length === 0}
                onClick={() => void decide(batch.batchId, "reject")}
              >
                {rejecting ? "拒绝中" : "全部拒绝"}
              </WorkbenchButton>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function createBrowserApi(projectId: string): KnowledgeReviewQueueApi {
  return {
    async decide(batchId, input) {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/knowledge/batches/${encodeURIComponent(batchId)}/decision`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            commandId: typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `knowledge-${Date.now().toString(36)}`,
            ...input,
          }),
        },
      );
      const body = await readJsonBody(response) as { ok?: boolean; result?: unknown; error?: string };
      if (!body || !response.ok || !body.ok) throw new Error(body?.error ?? "知识审核操作失败，请重试");
      return body.result;
    },
  };
}

async function readJsonBody(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text.trim()) throw new Error("服务暂时不可用，请稍后重试");
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("服务返回了无法解析的响应，请稍后重试");
  }
}
