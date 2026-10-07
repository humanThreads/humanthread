"use client";

import type { WorkflowInteractionView } from "@humanthread/shared";
import { Check, CheckCircle2, CircleAlert, ExternalLink, FileText, MessageSquare, ShieldCheck, UserRound } from "lucide-react";

export function WorkflowInteractionThread({ interaction }: { interaction: WorkflowInteractionView | Record<string, unknown> }) {
  const messages = Array.isArray(interaction.messages) ? interaction.messages : [];
  const decision = interaction.decision && typeof interaction.decision === "object" ? interaction.decision as Record<string, unknown> : null;
  const status = typeof interaction.status === "string" ? interaction.status : "open";
  return (
    <section aria-label="开放讨论记录" className="min-w-0 border-t border-[#d0d7de] bg-white">
      <div className="flex items-center justify-between border-b border-[#d0d7de] px-4 py-3">
        <div className="flex items-center gap-2"><MessageSquare aria-hidden="true" className="h-4 w-4 text-[#57606a]" /><h2 className="text-sm font-semibold text-[#24292f]">开放讨论</h2></div>
        <span className="text-xs text-[#57606a]">{statusLabel(status)}</span>
      </div>
      <ol className="max-h-80 divide-y divide-[#d8dee4] overflow-y-auto">
        {messages.length === 0 ? <li className="px-4 py-5 text-sm text-[#57606a]">暂无沟通消息。</li> : messages.map((value, index) => {
          if (!value || typeof value !== "object") return null;
          const message = value as Record<string, unknown>;
          const actorType = typeof message.actorType === "string" ? message.actorType : "system";
          const body = typeof message.body === "string" ? message.body : "";
          const answers = message.answers && typeof message.answers === "object" ? message.answers as Record<string, unknown> : {};
          return (
            <li key={typeof message.id === "string" ? message.id : `${index}`} className="flex gap-3 px-4 py-3 text-sm">
              <UserRound aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[#57606a]" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-xs text-[#57606a]"><span className="font-semibold text-[#24292f]">{actorLabel(actorType)}</span>{typeof message.createdAt === "string" ? <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time> : null}</div>
                {body ? <p className="mt-1 whitespace-pre-wrap break-words leading-6 text-[#24292f]">{body}</p> : null}
                {Object.keys(answers).length > 0 ? <dl className="mt-2 grid gap-1 border-l-2 border-[#d0d7de] pl-3 text-xs text-[#57606a]">{Object.entries(answers).map(([key, raw]) => <div key={key}><dt className="inline font-medium text-[#24292f]">{key}：</dt><dd className="inline">{Array.isArray(raw) ? raw.join("、") : String(raw)}</dd></div>)}</dl> : null}
              </div>
            </li>
          );
        })}
      </ol>
      <ReviewPages interaction={interaction} />
      <DiscussionChecklist interaction={interaction} />
      {decision ? <div className="flex gap-2 border-t border-[#d0d7de] bg-[#f6f8fa] px-4 py-3 text-xs text-[#57606a]"><ShieldCheck aria-hidden="true" className="h-4 w-4 shrink-0 text-[#1f883d]" /><div><span className="font-semibold text-[#24292f]">{decisionLabel(String(decision.decision ?? ""))}</span>{typeof decision.reason === "string" && decision.reason ? <span>：{decision.reason}</span> : null}</div></div> : status !== "open" ? <div className="flex gap-2 border-t border-[#d0d7de] bg-[#f6f8fa] px-4 py-3 text-xs text-[#57606a]"><Check aria-hidden="true" className="h-4 w-4 shrink-0 text-[#1f883d]" />历史已固化，不能继续修改。</div> : null}
    </section>
  );
}

/**
 * Pages an Agent attached to its question. They are proxied rather than stored
 * as artifacts, so the human reads them inline and then answers in the same
 * thread; the answer travels back to the Agent through get_workflow_intervention.
 */
function ReviewPages({ interaction }: { interaction: WorkflowInteractionView | Record<string, unknown> }) {
  const interactionId = typeof interaction.id === "string" ? interaction.id : "";
  const policy = interaction.policySnapshot && typeof interaction.policySnapshot === "object"
    ? interaction.policySnapshot as Record<string, unknown>
    : null;
  const pages = Array.isArray(policy?.reviewPages) ? policy.reviewPages : [];
  if (!interactionId || pages.length === 0) return null;
  return <section className="grid gap-3 border-t border-[#d0d7de] bg-[#f6f8fa] px-4 py-3" aria-label="Agent 审阅页">
    {pages.map((value, index) => {
      if (!value || typeof value !== "object") return null;
      const page = value as Record<string, unknown>;
      const token = typeof page.token === "string" ? page.token : "";
      if (!/^[a-f0-9]{32}$/u.test(token)) return null;
      const fileName = typeof page.fileName === "string" && page.fileName ? page.fileName : "审阅页";
      const href = `/api/workflow-interactions/${encodeURIComponent(interactionId)}/pages/${token}`;
      return <div key={token || index} className="overflow-hidden rounded-md border border-[#d0d7de] bg-white">
        <header className="flex min-w-0 items-center gap-2 border-b border-[#d8dee4] px-3 py-2">
          <FileText aria-hidden="true" className="h-4 w-4 shrink-0 text-[#59636e]" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[#24292f]">{fileName}</span>
          <a href={href} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-[#0969da] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0969da]">
            <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />在新窗口打开
          </a>
        </header>
        <iframe
          title={`审阅页：${fileName}`}
          src={href}
          sandbox=""
          referrerPolicy="no-referrer"
          loading="lazy"
          className="block h-[min(58vh,560px)] w-full bg-white"
        />
      </div>;
    })}
  </section>;
}

function DiscussionChecklist({ interaction }: { interaction: WorkflowInteractionView | Record<string, unknown> }) {
  const state = interaction.discussionState && typeof interaction.discussionState === "object"
    ? interaction.discussionState as Record<string, unknown>
    : null;
  const phase = state?.phase === "conflict_resolution" ? "conflict_resolution" : "ordinary";
  const speakers = Array.isArray(state?.speakers) ? state.speakers.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object") : [];
  if (speakers.length === 0 && phase === "ordinary") {
    return <div className="border-t border-[#d0d7de] bg-[#f6f8fa] px-4 py-3 text-xs text-[#57606a]">暂时没有参与人发言，任务负责人可以直接提交。</div>;
  }
  const missing = speakers.filter((speaker) => speaker.confirmed !== true);
  const activeSpeakerKey = typeof state?.activeSpeakerKey === "string" ? state.activeSpeakerKey : null;
  return (
    <div className="border-t border-[#d0d7de] bg-[#f6f8fa] px-4 py-3" aria-label="发言确认清单">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold text-[#24292f]">{phase === "conflict_resolution" ? "二次确认发言人" : "发言确认"}</span>
        <span className="text-[11px] tabular-nums text-[#57606a]">{speakers.filter((speaker) => speaker.confirmed === true).length}/{speakers.length} 已确认</span>
      </div>
      <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
        {speakers.map((speaker, index) => {
          const key = typeof speaker.speakerKey === "string" ? speaker.speakerKey : `${index}`;
          const name = typeof speaker.displayName === "string" && speaker.displayName ? speaker.displayName : "参与人";
          const confirmed = speaker.confirmed === true;
          const active = phase === "conflict_resolution" && key === activeSpeakerKey;
          return <li className="flex min-w-0 items-center gap-2 text-xs text-[#57606a]" key={key}>
            {confirmed ? <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[#1f883d]" /> : <CircleAlert aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[#9a6700]" />}
            <span className="min-w-0 truncate font-medium text-[#24292f]">{name}</span>
            <span className="truncate">{active ? "当前发言人" : confirmed ? "已确认" : "待确认"}</span>
          </li>;
        })}
      </ul>
      {phase === "ordinary" && missing.length > 0 ? <p className="mt-2 text-xs leading-5 text-[#7d4e00]">等待 {missing.map((speaker) => typeof speaker.displayName === "string" ? speaker.displayName : "参与人").join("、")} 确认</p> : null}
      {phase === "conflict_resolution" && activeSpeakerKey ? <p className="mt-2 text-xs leading-5 text-[#57606a]">只有当前发言人可以继续发言并确认提交，其他参与人只读。</p> : null}
    </div>
  );
}

function statusLabel(status: string) { return ({ open: "待处理", confirmed: "已确认", approved: "已批准", rejected: "已拒绝", cancelled: "已取消", expired: "已过期" } as Record<string, string>)[status] ?? status; }
function actorLabel(type: string) { return ({ user: "用户", agent: "Agent", system: "系统" } as Record<string, string>)[type] ?? type; }
function decisionLabel(decision: string) { return ({ confirmed: "用户已确认", approved: "用户已批准", rejected: "用户已拒绝", cancelled: "交互已取消", expired: "交互已过期" } as Record<string, string>)[decision] ?? decision; }
function formatTime(value: string) { return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
