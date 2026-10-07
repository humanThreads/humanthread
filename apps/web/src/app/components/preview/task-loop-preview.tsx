"use client";

import {
  Activity,
  ArrowLeft,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  FileText,
  GitBranch,
  Info,
  Laptop,
  MessageSquare,
  Play,
  Server,
  ShieldCheck,
  UserRound,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { WorkbenchShell } from "../workbench-shell";

type LoopOption = {
  id: string;
  name: string;
  description: string;
  version: number;
  nodes: number;
  gates: number;
  isDefault?: boolean;
  ready: boolean;
  reason?: string;
};

type ExecutionTarget = {
  id: string;
  name: string;
  description: string;
  type: "worker" | "local";
  capacity?: string;
  ready: boolean;
  reason?: string;
};

const LOOP_OPTIONS: readonly LoopOption[] = [
  {
    id: "branch-development",
    name: "分支开发 Loop",
    description: "创建任务分支、执行实现、运行检查并提交候选结果。",
    version: 12,
    nodes: 7,
    gates: 2,
    isDefault: true,
    ready: true,
  },
  {
    id: "fast-fix",
    name: "快速修复 Loop",
    description: "面向单点缺陷的短流程，保留代码检查与验收门禁。",
    version: 8,
    nodes: 5,
    gates: 1,
    ready: true,
  },
  {
    id: "release-validation",
    name: "发布验收 Loop",
    description: "包含预发验证、人工确认和生产发布步骤。",
    version: 5,
    nodes: 9,
    gates: 3,
    ready: false,
    reason: "尚未配置 Worker 节点模型",
  },
] as const;

const EXECUTION_TARGETS: readonly ExecutionTarget[] = [
  {
    id: "standard-worker",
    name: "标准 Linux Worker",
    description: "linux-worker-dev · 固定镜像摘要",
    type: "worker",
    capacity: "2 / 4 个执行槽可用",
    ready: true,
  },
  {
    id: "local-agent",
    name: "本地 Agent · agent-mac",
    description: "Codex · 工作区 HumanThread",
    type: "local",
    ready: false,
    reason: "运行时当前离线",
  },
] as const;

const ACCEPTANCE_CHECKS = [
  "任务启动时必须从项目当前可用 Loop 中选择根流程。",
  "默认值来自项目配置，但用户可以针对本次执行切换 Loop。",
  "启动前明确显示 Loop、执行目标和配置快照，缺失配置时给出阻断原因。",
] as const;

const ACTIVITY_ITEMS = [
  { id: "activity-1", actor: "林墨", action: "更新了验收要求", time: "12 分钟前", tone: "blue" },
  { id: "activity-2", actor: "HumanThread", action: "同步项目 Loop 配置", time: "36 分钟前", tone: "green" },
  { id: "activity-3", actor: "周宁", action: "将任务设为高优先级", time: "昨天 17:42", tone: "neutral" },
] as const;

export function TaskLoopPreview() {
  const [loopId, setLoopId] = useState("branch-development");
  const [targetId, setTargetId] = useState("standard-worker");
  const [launchState, setLaunchState] = useState<"idle" | "starting" | "success">("idle");
  const timerRef = useRef<number | null>(null);
  const selectedLoop = LOOP_OPTIONS.find((option) => option.id === loopId)!;
  const selectedTarget = EXECUTION_TARGETS.find((option) => option.id === targetId)!;

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  function selectLoop(nextId: string) {
    setLoopId(nextId);
    setLaunchState("idle");
  }

  function selectTarget(nextId: string) {
    setTargetId(nextId);
    setLaunchState("idle");
  }

  function startLoop() {
    setLaunchState("starting");
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setLaunchState("success");
      timerRef.current = null;
    }, 600);
  }

  return (
    <WorkbenchShell activeKey="tasks" title="任务执行" subtitle="任务详情与 Loop 启动" contentMode="workspace">
      <div className="h-full min-h-0 overflow-y-auto bg-[#f6f8fa] xl:grid xl:grid-cols-[minmax(0,1fr)_430px] xl:overflow-hidden">
        <section className="min-w-0 xl:min-h-0 xl:overflow-y-auto" aria-label="任务详情">
          <header className="sticky top-0 z-20 border-b border-[#d0d7de] bg-white px-4 py-4 shadow-[0_1px_0_rgba(31,35,40,0.03)] sm:px-6 lg:px-8">
            <nav className="flex min-w-0 items-center gap-1.5 text-xs text-[#57606a]" aria-label="任务路径">
              <Link href="/tasks" className="inline-flex min-w-0 items-center gap-1.5 font-medium text-[#57606a] hover:text-[#0969da] hover:underline">
                <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">任务中心</span>
              </Link>
              <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[#8c959f]" />
              <span className="truncate">HUMANTHREAD</span>
              <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[#8c959f]" />
              <span className="shrink-0 font-mono text-[11px] text-[#57606a]">HT100048</span>
            </nav>

            <div className="mt-3 flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[#2da44e33] bg-[#dafbe1] px-2 py-0.5 text-xs font-semibold text-[#116329]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#1f883d]" aria-hidden="true" />
                    开发中
                  </span>
                  <span className="rounded-full border border-[#d4a72c33] bg-[#fff8c5] px-2 py-0.5 text-xs font-semibold text-[#9a6700]">高优先级</span>
                </div>
                <h1 className="mt-2 max-w-4xl text-2xl font-semibold tracking-[-0.02em] text-[#24292f]">
                  允许任务启动时选择执行 Loop
                </h1>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-[#57606a]">
                  Loop 配置变更后，任务应选择当前项目可用的根流程，不再固定依赖旧的任务开发绑定。
                </p>
              </div>
              <span className="rounded-md border border-[#d0d7de] bg-[#f6f8fa] px-2 py-1 text-[11px] font-semibold text-[#57606a]">界面预览</span>
            </div>

            <dl className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-[#57606a]">
              <div className="flex items-center gap-1.5"><Workflow aria-hidden="true" className="h-3.5 w-3.5" /><dt className="sr-only">项目</dt><dd>HumanThread</dd></div>
              <div className="flex items-center gap-1.5"><UserRound aria-hidden="true" className="h-3.5 w-3.5" /><dt className="sr-only">负责人</dt><dd>林墨</dd></div>
              <div className="flex items-center gap-1.5"><CalendarClock aria-hidden="true" className="h-3.5 w-3.5" /><dt className="sr-only">截止时间</dt><dd>10 月 3 日</dd></div>
              <div className="flex items-center gap-1.5"><GitBranch aria-hidden="true" className="h-3.5 w-3.5" /><dt className="sr-only">分支</dt><dd className="font-mono text-[11px]">2026-HT100048</dd></div>
            </dl>
          </header>

          <div className="mx-auto grid w-full max-w-5xl gap-6 px-4 py-5 sm:px-6 lg:px-8">
            <nav className="flex items-center gap-5 overflow-x-auto border-b border-[#d0d7de] text-sm" aria-label="任务页面导航">
              <a href="#overview" className="shrink-0 border-b-2 border-[#0969da] px-0.5 pb-2 font-semibold text-[#0969da]">任务详情</a>
              <a href="#activity" className="shrink-0 px-0.5 pb-2 text-[#57606a] hover:text-[#24292f]">最近活动 <span className="text-[#8c959f]">3</span></a>
              <a href="#related" className="shrink-0 px-0.5 pb-2 text-[#57606a] hover:text-[#24292f]">关联内容 <span className="text-[#8c959f]">2</span></a>
              <a href="#runs" className="shrink-0 px-0.5 pb-2 text-[#57606a] hover:text-[#24292f]">运行记录</a>
            </nav>

            <section id="overview" className="grid gap-4" aria-labelledby="overview-title">
              <div className="border-y border-[#d0d7de] bg-white px-4 py-4 sm:px-5">
                <h2 id="overview-title" className="text-sm font-semibold text-[#24292f]">任务目标</h2>
                <div className="mt-3 max-w-3xl space-y-3 text-sm leading-6 text-[#57606a]">
                  <p>调整任务 Loop 启动链路：后端根据项目当前启用的项目级 Loop 返回候选列表，前端在独立任务页中完成 Loop 与执行目标选择。</p>
                  <p>创建运行前保存 Loop 版本、执行目标和策略快照；历史运行保持原样，不因配置变更回写。</p>
                </div>
              </div>

              <div className="border-y border-[#d0d7de] bg-white px-4 py-4 sm:px-5">
                <div className="flex items-center gap-2">
                  <ShieldCheck aria-hidden="true" className="h-4 w-4 text-[#1f883d]" />
                  <h2 className="text-sm font-semibold text-[#24292f]">验收要求</h2>
                </div>
                <ul className="mt-3 divide-y divide-[#eef1f4] text-sm text-[#57606a]">
                  {ACCEPTANCE_CHECKS.map((item) => (
                    <li key={item} className="flex gap-3 py-2.5 first:pt-0 last:pb-0">
                      <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border border-[#1f883d] bg-[#dafbe1] text-[#116329]" aria-hidden="true"><Check className="h-3 w-3" /></span>
                      <span className="leading-6">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>

            <section id="activity" className="border-y border-[#d0d7de] bg-white px-4 py-4 sm:px-5" aria-labelledby="activity-title">
              <div className="flex items-center gap-2">
                <Activity aria-hidden="true" className="h-4 w-4 text-[#57606a]" />
                <h2 id="activity-title" className="text-sm font-semibold text-[#24292f]">最近活动</h2>
              </div>
              <ol className="mt-3 divide-y divide-[#eef1f4]">
                {ACTIVITY_ITEMS.map((item) => (
                  <li key={item.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.tone === "green" ? "bg-[#1f883d]" : item.tone === "blue" ? "bg-[#0969da]" : "bg-[#8c959f]"}`} aria-hidden="true" />
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="text-[#24292f]"><strong className="font-semibold">{item.actor}</strong> {item.action}</p>
                      <p className="mt-0.5 text-xs text-[#8c959f]">{item.time}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            <section id="related" className="grid gap-3 border-y border-[#d0d7de] bg-white px-4 py-4 sm:px-5" aria-labelledby="related-title">
              <h2 id="related-title" className="text-sm font-semibold text-[#24292f]">关联内容</h2>
              <div className="divide-y divide-[#eef1f4]">
                <button type="button" className="flex w-full items-center gap-3 py-3 text-left first:pt-0 hover:text-[#0969da]">
                  <FileText aria-hidden="true" className="h-4 w-4 shrink-0 text-[#57606a]" />
                  <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-[#24292f]">任务执行页面设计稿</span><span className="mt-0.5 block text-xs text-[#57606a]">需求文档 · 版本 4</span></span>
                  <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-[#8c959f]" />
                </button>
                <button type="button" className="flex w-full items-center gap-3 py-3 text-left last:pb-0 hover:text-[#0969da]">
                  <MessageSquare aria-hidden="true" className="h-4 w-4 shrink-0 text-[#57606a]" />
                  <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-[#24292f]">配置变更后的启动策略讨论</span><span className="mt-0.5 block text-xs text-[#57606a]">讨论 · 6 条回复</span></span>
                  <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-[#8c959f]" />
                </button>
              </div>
            </section>

            <section id="runs" className="border-y border-[#d0d7de] bg-white px-4 py-4 sm:px-5" aria-labelledby="runs-title">
              <h2 id="runs-title" className="text-sm font-semibold text-[#24292f]">运行记录</h2>
              <div className="mt-3 flex items-center gap-3 border border-[#d0d7de] bg-[#f6f8fa] px-3 py-3 text-sm">
                <CircleAlert aria-hidden="true" className="h-4 w-4 shrink-0 text-[#9a6700]" />
                <div className="min-w-0 flex-1"><p className="font-medium text-[#24292f]">上次启动未创建运行</p><p className="mt-0.5 text-xs text-[#57606a]">旧绑定已失效，当前页面提供新的 Loop 选择入口。</p></div>
              </div>
            </section>
          </div>
        </section>

        <aside className="flex min-h-0 flex-col border-t border-[#d0d7de] bg-white xl:border-l xl:border-t-0" aria-label="Loop 启动设置">
          <header className="shrink-0 border-b border-[#d0d7de] px-4 py-4 sm:px-5">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Workflow aria-hidden="true" className="h-4 w-4 text-[#0969da]" />
                  <h2 className="text-base font-semibold text-[#24292f]">启动 Loop</h2>
                </div>
                <p className="mt-1 text-xs leading-5 text-[#57606a]">为本次执行冻结 Loop、目标和配置快照。</p>
              </div>
              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${launchState === "success" ? "border-[#2da44e33] bg-[#dafbe1] text-[#116329]" : "border-[#d0d7de] bg-[#f6f8fa] text-[#57606a]"}`}>
                {launchState === "success" ? "已启动" : "未启动"}
              </span>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5 xl:overscroll-contain">
            <div className="grid gap-5">
              <fieldset className="grid gap-2">
                <legend className="mb-1 flex w-full items-center gap-2 text-sm font-semibold text-[#24292f]">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#24292f] text-[11px] text-white">1</span>
                  选择执行 Loop
                </legend>
                <div className="divide-y divide-[#d8dee4] border-y border-[#d0d7de]">
                  {LOOP_OPTIONS.map((option) => {
                    const checked = loopId === option.id;
                    return (
                      <label key={option.id} className={`group flex cursor-pointer gap-3 px-3 py-3 transition-colors ${option.ready ? checked ? "bg-[#ddf4ff]" : "hover:bg-[#f6f8fa]" : "cursor-not-allowed bg-[#f6f8fa] opacity-70"}`}>
                        <input type="radio" name="task-loop" value={option.id} checked={checked} disabled={!option.ready} onChange={() => selectLoop(option.id)} className="sr-only" />
                        <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border ${checked ? "border-[#0969da] bg-[#0969da] text-white" : "border-[#8c959f] bg-white"}`} aria-hidden="true">
                          {checked ? <span className="h-1.5 w-1.5 rounded-full bg-white" /> : null}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-[#24292f]">{option.name}</span>
                            {option.isDefault ? <span className="rounded-full border border-[#0969da33] bg-[#ddf4ff] px-1.5 py-0.5 text-xs font-semibold text-[#0a3069]">默认</span> : null}
                            {!option.ready ? <span className="rounded-full border border-[#cf222e33] bg-[#ffebe9] px-1.5 py-0.5 text-xs font-semibold text-[#cf222e]">不可用</span> : null}
                          </span>
                          <span className="mt-1 block text-xs leading-5 text-[#57606a]">{option.description}</span>
                          <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#6e7781]">
                            <span>版本 {option.version}</span>
                            <span>{option.nodes} 个节点</span>
                            <span>{option.gates} 个人工门禁</span>
                          </span>
                          {option.reason ? <span className="mt-2 flex items-center gap-1 text-xs font-medium text-[#cf222e]"><CircleAlert aria-hidden="true" className="h-3.5 w-3.5" />{option.reason}</span> : null}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              <fieldset className="grid gap-2">
                <legend className="mb-1 flex w-full items-center gap-2 text-sm font-semibold text-[#24292f]">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#24292f] text-[11px] text-white">2</span>
                  选择执行目标
                </legend>
                <div className="divide-y divide-[#d8dee4] border-y border-[#d0d7de]">
                  {EXECUTION_TARGETS.map((option) => {
                    const checked = targetId === option.id;
                    const TargetIcon = option.type === "worker" ? Server : Laptop;
                    return (
                      <label key={option.id} className={`group flex cursor-pointer gap-3 px-3 py-3 transition-colors ${option.ready ? checked ? "bg-[#dafbe1]" : "hover:bg-[#f6f8fa]" : "cursor-not-allowed bg-[#f6f8fa] opacity-70"}`}>
                        <input type="radio" name="execution-target" value={option.id} checked={checked} disabled={!option.ready} onChange={() => selectTarget(option.id)} className="sr-only" />
                        <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border ${checked ? "border-[#1f883d] bg-[#1f883d] text-white" : "border-[#8c959f] bg-white"}`} aria-hidden="true">
                          {checked ? <span className="h-1.5 w-1.5 rounded-full bg-white" /> : null}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <TargetIcon aria-hidden="true" className="h-4 w-4 shrink-0 text-[#57606a]" />
                            <span className="text-sm font-semibold text-[#24292f]">{option.name}</span>
                          </span>
                          <span className="mt-1 block text-xs leading-5 text-[#57606a]">{option.description}</span>
                          {option.capacity ? <span className="mt-2 block text-[11px] font-medium text-[#116329]">{option.capacity}</span> : null}
                          {option.reason ? <span className="mt-2 flex items-center gap-1 text-xs font-medium text-[#cf222e]"><CircleAlert aria-hidden="true" className="h-3.5 w-3.5" />{option.reason}</span> : null}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              <section className="grid gap-3" aria-labelledby="preflight-title">
                <div className="flex items-center gap-2">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#24292f] text-[11px] text-white">3</span>
                  <h2 id="preflight-title" className="text-sm font-semibold text-[#24292f]">启动前检查</h2>
                </div>
                <div className="border border-[#2da44e33] bg-[#dafbe1] px-3 py-3 text-sm text-[#116329]" role="status">
                  <div className="flex items-start gap-2">
                    <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                    <div className="min-w-0">
                      <p className="font-semibold">预检通过</p>
                      <p className="mt-1 text-xs leading-5">{selectedLoop.name} v{selectedLoop.version} · {selectedTarget.name}</p>
                    </div>
                  </div>
                  <ul className="mt-3 grid gap-2 border-t border-[#2da44e26] pt-3 text-xs">
                    <li className="flex items-center gap-2"><Check aria-hidden="true" className="h-3.5 w-3.5" />Loop 版本已固定</li>
                    <li className="flex items-center gap-2"><Check aria-hidden="true" className="h-3.5 w-3.5" />执行目标配置完整</li>
                    <li className="flex items-center gap-2"><Check aria-hidden="true" className="h-3.5 w-3.5" />任务分支与权限可用</li>
                  </ul>
                </div>
                <p className="flex items-start gap-2 text-xs leading-5 text-[#57606a]">
                  <Info aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#0969da]" />
                  启动后会生成不可变运行快照；后续修改项目 Loop 配置不会影响本次运行。
                </p>
              </section>

            </div>
          </div>

          <footer className="shrink-0 border-t border-[#d0d7de] bg-white px-4 py-3 sm:px-5">
            {launchState === "success" ? (
              <div role="status" aria-live="polite" className="mb-3 flex items-start gap-2 border border-[#2da44e33] bg-[#f0fff4] px-3 py-2 text-xs text-[#116329]">
                <CheckCircle2 aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div><p className="font-semibold">Loop 已启动</p><p className="mt-0.5">运行 ID：loop_run_preview_0912</p></div>
              </div>
            ) : null}
            <button
              type="button"
              disabled={launchState === "starting"}
              onClick={startLoop}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-[#1f883d] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#1a7f37] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1f883d] focus-visible:ring-offset-2 disabled:cursor-wait disabled:bg-[#8c959f]"
            >
              {launchState === "starting" ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white motion-reduce:animate-none" aria-hidden="true" /> : <Play aria-hidden="true" className="h-4 w-4" />}
              {launchState === "starting" ? "正在创建运行..." : launchState === "success" ? "重新启动 Loop" : "启动 Loop"}
            </button>
            <p className="mt-2 text-center text-[11px] leading-4 text-[#6e7781]">本次使用 {selectedLoop.name} v{selectedLoop.version}</p>
          </footer>
        </aside>
      </div>
    </WorkbenchShell>
  );
}
