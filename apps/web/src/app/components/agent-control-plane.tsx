"use client";

import { Clock3, Cpu, ShieldCheck, WifiOff } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import { AgentProfileManager, type AgentProfileManagerItem } from "./agent-profile-manager";
import { ApprovalDecisionDialog, type ApprovalDecisionItem } from "./approval-decision-dialog";
import { StatusPill } from "./workbench-ui";

export function AgentControlPlane({ profiles, workers, workerPools = [], approvals, canManageProfiles = false, selectedSpaceId = null, children }: {
  profiles: AgentProfileManagerItem[];
  workers: Array<{ id: string; name: string; runtimeType: string; agentVersion: string | null; status: string; activeRunCount: number; maxConcurrentRuns: number; lastHeartbeatAt: Date | null }>;
  workerPools?: Array<{
    id: string;
    displayName: string;
    health: string;
    currentRuns: number;
    capacity: number;
    runtime?: "docker" | "kubernetes";
    taskGroupName?: string | null;
    aliveInstanceCount?: number;
    instances: Array<{ instanceId: string; health: string }>;
  }>;
  approvals: Array<ApprovalDecisionItem & { status: string; createdAt: Date }>;
  canManageProfiles?: boolean;
  selectedSpaceId?: string | null;
  children?: ReactNode;
}) {
  const [visibleApprovals, setVisibleApprovals] = useState(approvals);
  const [selectedApproval, setSelectedApproval] = useState<(typeof approvals)[number] | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const approvalTitle = (approval: ApprovalDecisionItem) => approval.taskShortId && approval.taskTitle
    ? `${approval.taskShortId} · ${approval.taskTitle}`
    : approval.taskShortId ?? approval.taskTitle ?? approval.type;
  const approvalContext = (approval: ApprovalDecisionItem) => [approval.projectName, approval.loopLabel, approval.nodeLabel]
    .filter(Boolean)
    .join(" · ");
  return <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
    <div className="grid content-start gap-5">
      <section aria-labelledby="agent-resources-title" className="grid gap-3 rounded-md border border-[#d0d7de] bg-white p-4">
        <div className="flex items-end justify-between gap-3 border-b border-[#d8dee4] pb-3">
          <div>
            <h2 id="agent-resources-title" className="text-sm font-semibold">执行配置与资源</h2>
            <p className="mt-1 text-xs leading-5 text-[#59636e]">先确认真实 Provider、设备与 Worker 资源，再处理运行监控。</p>
          </div>
          <span className="shrink-0 text-xs text-[#59636e]">{profiles.length} Profile · {workers.length} Worker · {workerPools.length} Pool</span>
        </div>
        <AgentProfileManager canManage={canManageProfiles} initialProfiles={profiles} spaceId={selectedSpaceId} />
        <section className="overflow-hidden rounded-md border border-[#d0d7de] bg-white"><header className="border-b border-[#d8dee4] px-4 py-3"><h3 className="text-sm font-semibold">Workers</h3></header><div className="divide-y divide-[#d8dee4]">{workers.map((worker) => <div key={worker.id} className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_160px_120px]"><div className="flex items-center gap-3">{worker.status === "offline" ? <WifiOff className="size-4 text-[#cf222e]" /> : <Cpu className="size-4 text-[#1a7f37]" />}<div><div className="text-sm font-medium">{worker.name}</div><div className="text-xs text-[#59636e]">{worker.runtimeType} · {worker.agentVersion ?? "版本未知"}</div></div></div><div className="text-xs text-[#59636e]">容量 {worker.activeRunCount}/{worker.maxConcurrentRuns}</div><StatusPill tone={worker.status === "online" ? "success" : "danger"}>{worker.status === "offline" ? "离线" : worker.status}</StatusPill></div>)}</div></section>
        <section className="overflow-hidden rounded-md border border-[#d0d7de] bg-white"><header className="border-b border-[#d8dee4] px-4 py-3"><h3 className="text-sm font-semibold">Linux Worker Pool</h3></header><div className="divide-y divide-[#d8dee4]">{workerPools.map((pool) => <div key={pool.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_150px_120px]"><div><div className="text-sm font-medium">{pool.displayName}</div>{pool.runtime === "kubernetes" ? <div className="text-xs text-[#59636e]">Kubernetes 任务组 {pool.taskGroupName ?? pool.displayName} · 存活实例 {pool.aliveInstanceCount ?? 0}</div> : <div className="text-xs text-[#59636e]">实例 {pool.instances.length}{pool.instances.length ? ` · ${pool.instances.map((instance) => instance.instanceId).join("、")}` : ""}</div>}</div><div className="text-xs text-[#59636e]">运行/容量 {pool.currentRuns}/{pool.capacity}</div><StatusPill tone={pool.health === "idle" || pool.health === "running" ? "success" : "danger"}>{pool.health}</StatusPill></div>)}{workerPools.length === 0 ? <p className="px-4 py-6 text-sm text-[#59636e]">当前 Space 尚无 Linux Worker Pool</p> : null}</div></section>
      </section>
      {children}
    </div>
    <aside id="approvals" className="scroll-mt-20 overflow-hidden rounded-md border border-[#d0d7de] bg-white"><header className="flex items-center gap-2 border-b border-[#d8dee4] px-4 py-3"><ShieldCheck className="size-4" /><h2 className="text-sm font-semibold">审批箱</h2><span className="ml-auto rounded-full bg-[#fff8c5] px-2 py-0.5 text-xs">{visibleApprovals.filter((item) => item.status === "pending").length}</span></header>{status ? <p role="status" className="border-b border-[#7ee787] bg-[#dafbe1] px-4 py-2 text-xs font-medium text-[#116329]">{status}</p> : null}<div className="divide-y divide-[#d8dee4]">{visibleApprovals.map((approval) => {
      const context = approvalContext(approval);
      return <button type="button" key={approval.id} onClick={() => { setSelectedApproval(approval); setStatus(null); }} className="block w-full px-4 py-3 text-left hover:bg-[#f6f8fa] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0969da]"><div className="flex min-w-0 items-start justify-between gap-2"><span className="min-w-0 break-words text-sm font-semibold text-[#24292f]">{approvalTitle(approval)}</span><StatusPill tone="warning">{approval.type}</StatusPill></div>{context ? <p className="mt-1 break-words text-xs text-[#59636e]">{context}</p> : null}<div className="mt-2 flex items-center gap-1.5 text-xs font-medium text-[#9a6700]"><Clock3 className="size-3.5" />{approval.status === "pending" ? "等待审批" : approval.status}</div><p className="mt-1 line-clamp-2 text-xs text-[#59636e]">{approval.prompt ?? approval.policyReason}</p></button>;
    })}</div>{visibleApprovals.length === 0 ? <p className="px-4 py-8 text-center text-sm text-[#59636e]">暂无待审批操作</p> : null}</aside>
    {selectedApproval ? <ApprovalDecisionDialog key={selectedApproval.id} open approval={selectedApproval} onClose={() => setSelectedApproval(null)} onDecided={({ approvalId, decision }) => { setVisibleApprovals((items) => items.filter((item) => item.id !== approvalId)); setStatus(decision === "approved" ? "操作已批准" : decision === "changes_requested" ? "已退回修改" : "操作已驳回"); }} /> : null}
  </div>;
}
