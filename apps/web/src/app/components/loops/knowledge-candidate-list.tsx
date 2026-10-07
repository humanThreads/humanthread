"use client";

import Link from "next/link";
import { BookOpen, Check, ExternalLink, ShieldAlert, X } from "lucide-react";
import { useMemo, useState } from "react";

import { EmptyState, StatusPill, WorkbenchButton } from "../workbench-ui";

export type KnowledgeCandidateStatus =
  | "candidate"
  | "review_required"
  | "published"
  | "rejected"
  | "superseded";

export interface KnowledgeCandidateListItem {
  id: string;
  projectId: string;
  title: string;
  contentSummary: string;
  contentFingerprint: string;
  sourceRefs: Array<{
    loopRunId: string;
    nodeRunId?: string;
    eventId?: string;
    artifactId?: string;
  }>;
  confidence: number;
  redactionResult: Record<string, unknown>;
  conflictResult: Record<string, unknown>;
  extractorVersion: string;
  status: KnowledgeCandidateStatus;
  reviewedByUserId: string | null;
  reviewReason: string | null;
  publishedDocumentId: string | null;
  publishedDocumentVersion: number | null;
  createdAt: string;
}

interface KnowledgeCandidateListApi {
  decide(
    candidateId: string,
    input: { decision: "publish" | "reject" | "supersede"; reason?: string },
  ): Promise<KnowledgeCandidateListItem>;
}

const STATUS_LABELS: Record<KnowledgeCandidateStatus, string> = {
  candidate: "可自动发布",
  review_required: "需要审核",
  published: "已发布",
  rejected: "已拒绝",
  superseded: "已取代",
};

const FILTERS: Array<{ key: "all" | KnowledgeCandidateStatus; label: string }> = [
  { key: "all", label: "全部" },
  { key: "review_required", label: "待审核" },
  { key: "published", label: "已发布" },
  { key: "rejected", label: "已拒绝" },
];

export function KnowledgeCandidateList({
  projectId,
  initialCandidates,
  api = createBrowserApi(),
}: {
  projectId: string;
  initialCandidates: KnowledgeCandidateListItem[];
  api?: KnowledgeCandidateListApi;
}) {
  const [candidates, setCandidates] = useState(initialCandidates);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ candidateId: string; tone: "error" | "status"; text: string } | null>(null);
  const counts = useMemo(() => ({
    review: candidates.filter((candidate) => candidate.status === "review_required").length,
    published: candidates.filter((candidate) => candidate.status === "published").length,
  }), [candidates]);
  const visible = filter === "all"
    ? candidates
    : candidates.filter((candidate) => candidate.status === filter);

  async function decide(
    candidate: KnowledgeCandidateListItem,
    decision: "publish" | "reject",
  ) {
    const reason = reasons[candidate.id]?.trim() ?? "";
    if (decision === "reject" && !reason) {
      setNotice({ candidateId: candidate.id, tone: "error", text: "请填写拒绝原因" });
      return;
    }
    setPendingId(candidate.id);
    setNotice(null);
    try {
      const updated = await api.decide(candidate.id, {
        decision,
        ...(reason ? { reason } : {}),
      });
      setCandidates((current) => current.map((item) => item.id === updated.id ? updated : item));
      setNotice({
        candidateId: candidate.id,
        tone: "status",
        text: decision === "publish" ? "知识已发布为项目文档" : "知识候选已拒绝",
      });
    } catch (cause) {
      setNotice({
        candidateId: candidate.id,
        tone: "error",
        text: cause instanceof Error ? cause.message : "知识审核操作失败，请重试",
      });
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section className="mx-auto w-full max-w-6xl overflow-hidden rounded-lg border border-[#d0d7de] bg-white">
      <header className="flex flex-wrap items-center gap-3 border-b border-[#d8dee4] bg-[#f6f8fa] px-4 py-3">
        <div className="mr-auto min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-[#24292f]">
            <BookOpen aria-hidden="true" className="size-4 text-[#0969da]" />
            Loop 知识候选
          </h2>
          <p className="mt-1 text-xs leading-5 text-[#57606a]">
            待审核 {counts.review} 项 · 已发布 {counts.published} 项
          </p>
        </div>
        <div role="tablist" aria-label="候选状态" className="inline-flex max-w-full overflow-x-auto rounded-md border border-[#d0d7de] bg-white">
          {FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={filter === item.key}
              onClick={() => setFilter(item.key)}
              className={filter === item.key
                ? "shrink-0 border-r border-[#d0d7de] bg-[#0969da] px-3 py-1.5 text-xs font-semibold text-white last:border-r-0"
                : "shrink-0 border-r border-[#d0d7de] px-3 py-1.5 text-xs font-semibold text-[#57606a] hover:bg-[#f6f8fa] last:border-r-0"}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      {visible.length === 0 ? (
        <div className="p-4">
          <EmptyState
            title={candidates.length === 0 ? "尚无知识候选" : "当前筛选没有候选"}
            description={candidates.length === 0
              ? "Loop 成功结束并产出声明的知识内容后，候选会出现在这里。"
              : "切换状态筛选以查看其他知识候选。"}
          />
        </div>
      ) : (
        <div className="divide-y divide-[#d8dee4]">
          {visible.map((candidate) => (
            <KnowledgeCandidateRow
              key={candidate.id}
              projectId={projectId}
              candidate={candidate}
              reason={reasons[candidate.id] ?? ""}
              pending={pendingId === candidate.id}
              notice={notice?.candidateId === candidate.id ? notice : null}
              onReasonChange={(reason) => setReasons((current) => ({ ...current, [candidate.id]: reason }))}
              onPublish={() => decide(candidate, "publish")}
              onReject={() => decide(candidate, "reject")}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function KnowledgeCandidateRow({
  projectId,
  candidate,
  reason,
  pending,
  notice,
  onReasonChange,
  onPublish,
  onReject,
}: {
  projectId: string;
  candidate: KnowledgeCandidateListItem;
  reason: string;
  pending: boolean;
  notice: { tone: "error" | "status"; text: string } | null;
  onReasonChange(reason: string): void;
  onPublish(): void;
  onReject(): void;
}) {
  const reviewable = candidate.status === "candidate" || candidate.status === "review_required";
  const redactionCount = numberValue(candidate.redactionResult.redactionCount);
  const conflictCount = Array.isArray(candidate.conflictResult.conflicts)
    ? candidate.conflictResult.conflicts.length
    : 0;
  const conflicts = Array.isArray(candidate.conflictResult.conflicts)
    ? candidate.conflictResult.conflicts.flatMap((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return [];
        const record = value as Record<string, unknown>;
        return typeof record.documentId === "string" && typeof record.reason === "string"
          ? [{ documentId: record.documentId, reason: record.reason }]
          : [];
      })
    : [];
  const confidence = Math.round(Math.max(0, Math.min(1, candidate.confidence)) * 100);

  return (
    <article className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.42fr)]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-[#24292f]">{candidate.title}</h3>
          <CandidateStatus status={candidate.status} />
          <span className="text-xs text-[#57606a]">置信度 {confidence}%</span>
        </div>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#24292f]">{candidate.contentSummary}</p>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#57606a]">
          {candidate.redactionResult.status === "sensitive_content_detected" ? (
            <span className="inline-flex items-center gap-1 text-[#9a6700]">
              <ShieldAlert aria-hidden="true" className="size-3.5" />
              检测到敏感内容，已脱敏 {redactionCount} 处
            </span>
          ) : <span>未检测到敏感内容</span>}
          {conflictCount > 0 ? <span className="text-[#9a6700]">发现 {conflictCount} 项文档冲突</span> : <span>未发现文档冲突</span>}
          <span>提取器 {candidate.extractorVersion}</span>
        </div>
        <div className="mt-3 grid gap-2 border-t border-[#d8dee4] pt-3">
          {conflicts.length > 0 ? (
            <ul className="grid gap-1.5 text-xs leading-5 text-[#57606a]">
              {conflicts.map((conflict) => (
                <li key={conflict.documentId} className="flex flex-wrap items-baseline gap-x-2">
                  <Link
                    href={`/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(conflict.documentId)}`}
                    aria-label={`查看冲突文档 ${conflict.documentId}`}
                    className="font-semibold text-[#0969da] hover:underline"
                  >
                    冲突文档 {conflict.documentId}
                  </Link>
                  <span>{conflict.reason}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {candidate.sourceRefs.map((source, index) => (
            <div key={`${source.loopRunId}:${source.nodeRunId ?? index}`} className="min-w-0 text-xs leading-5 text-[#57606a]">
              <Link
                href={`/loop-runs/${encodeURIComponent(source.loopRunId)}`}
                className="inline-flex items-center gap-1 font-semibold text-[#0969da] hover:underline"
                aria-label={`打开运行 ${source.loopRunId}`}
              >
                运行 {source.loopRunId}<ExternalLink aria-hidden="true" className="size-3" />
              </Link>
              <div className="mt-0.5 break-words">
                {[
                  source.nodeRunId ? `节点 ${source.nodeRunId}` : null,
                  source.eventId ? `事件 ${source.eventId}` : null,
                  source.artifactId ? `产物 ${source.artifactId}` : null,
                ].filter(Boolean).join(" · ") || "Run 摘要"}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid content-start gap-3 border-t border-[#d8dee4] pt-4 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
        {reviewable ? (
          <>
            <label className="grid gap-1 text-xs font-semibold text-[#24292f]">
              审核说明
              <textarea
                aria-label="审核说明"
                value={reason}
                onChange={(event) => onReasonChange(event.currentTarget.value)}
                rows={3}
                maxLength={4_000}
                placeholder="拒绝时必须填写原因"
                className="min-h-20 w-full resize-y rounded-md border border-[#d0d7de] bg-white px-2.5 py-2 text-sm font-normal leading-5 text-[#24292f] outline-none focus:border-[#0969da] focus:ring-2 focus:ring-[#0969da33]"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <WorkbenchButton type="button" size="small" variant="primary" disabled={pending} onClick={onPublish}>
                <Check aria-hidden="true" className="size-3.5" />
                {pending ? "正在处理" : "发布为项目文档"}
              </WorkbenchButton>
              <WorkbenchButton type="button" size="small" variant="danger" disabled={pending} onClick={onReject}>
                <X aria-hidden="true" className="size-3.5" />拒绝候选
              </WorkbenchButton>
            </div>
          </>
        ) : candidate.status === "published" && candidate.publishedDocumentId && candidate.publishedDocumentVersion !== null ? (
          <Link
            href={`/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(candidate.publishedDocumentId)}`}
            className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md border border-[#d0d7de] bg-[#f6f8fa] px-3 py-1.5 text-xs font-semibold text-[#24292f] hover:bg-[#f3f4f6]"
          >
            <BookOpen aria-hidden="true" className="size-3.5" />
            打开文档 v{candidate.publishedDocumentVersion}
          </Link>
        ) : (
          <p className="text-xs leading-5 text-[#57606a]">{candidate.reviewReason ?? "该候选已结束审核。"}</p>
        )}
        {notice ? (
          <p role={notice.tone === "error" ? "alert" : "status"} className={notice.tone === "error" ? "text-xs leading-5 text-[#cf222e]" : "text-xs leading-5 text-[#116329]"}>
            {notice.text}
          </p>
        ) : null}
        <div className="break-all font-mono text-[11px] leading-5 text-[#6e7781]" title={candidate.contentFingerprint}>
          {candidate.contentFingerprint}
        </div>
      </div>
    </article>
  );
}

function CandidateStatus({ status }: { status: KnowledgeCandidateStatus }) {
  const tone = status === "published"
    ? "success"
    : status === "review_required"
      ? "warning"
      : status === "rejected"
        ? "danger"
        : status === "candidate"
          ? "blue"
          : "default";
  return <StatusPill tone={tone}>{STATUS_LABELS[status]}</StatusPill>;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function createBrowserApi(): KnowledgeCandidateListApi {
  return {
    async decide(candidateId, input) {
      const response = await fetch(`/api/knowledge-candidates/${encodeURIComponent(candidateId)}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          commandId: typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `knowledge-${Date.now().toString(36)}`,
          ...input,
        }),
      });
      const body = await response.json() as { ok?: boolean; result?: KnowledgeCandidateListItem; error?: string };
      if (!response.ok || !body.ok || !body.result) {
        throw new Error(body.error ?? "知识审核操作失败，请重试");
      }
      return body.result;
    },
  };
}
