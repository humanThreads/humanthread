"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { calculateNextScheduledTaskOccurrence } from "@humanthread/orchestration-core";
import { X } from "lucide-react";
import { useMemo, useState } from "react";

import type {
  ProjectScheduledTaskListItem,
  ProjectScheduledTaskLoopOption,
  ProjectScheduledTaskTargetOption,
} from "../../../lib/orchestration/scheduled-task-read-model";
import { WorkbenchButton } from "../workbench-ui";

type ContentMode = "platform" | "loop_managed";
type LoopOption = ProjectScheduledTaskLoopOption & { enabled?: boolean };

export function ProjectScheduledTaskDialog({
  projectId,
  mode,
  task,
  loopOptions,
  targetOptions,
  onSaved,
  onCancel,
}: {
  projectId: string;
  mode: "create" | "edit";
  task?: ProjectScheduledTaskListItem;
  loopOptions: LoopOption[];
  targetOptions: ProjectScheduledTaskTargetOption[];
  onSaved(): void;
  onCancel?: () => void;
}) {
  const enabledLoops = loopOptions.filter((option) => option.enabled !== false);
  const existingLoopId = task?.loopBinding?.id ?? null;
  const existingLoop = existingLoopId ? enabledLoops.find((option) => option.id === existingLoopId) ?? null : null;
  const unavailableLoop = mode === "edit" && task?.loopBinding && !existingLoop ? task.loopBinding : null;
  const initialLoopId = mode === "create" ? enabledLoops[0]?.id ?? "" : existingLoop?.id ?? "";
  const initialLoopTargets = targetsForLoop(enabledLoops, initialLoopId, targetOptions);
  const storedTarget = mode === "edit" && task?.executionTarget
    ? initialLoopTargets.find((option) => option.type === task.executionTarget?.type && option.id === task.executionTarget.id)
      ?? {
        ...task.executionTarget,
        ready: false,
        reason: "原执行目标已不可用，请重新选择",
        loopBindingIds: initialLoopId ? [initialLoopId] : [],
      }
    : null;
  const initialTarget = mode === "edit"
    ? storedTarget
    : initialLoopTargets.find((option) => option.ready) ?? initialLoopTargets[0] ?? null;
  const [name, setName] = useState(task?.name ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [loopBindingId, setLoopBindingId] = useState(initialLoopId);
  const [cronExpression, setCronExpression] = useState(task?.cronExpression ?? "0 9 * * *");
  const [timezone, setTimezone] = useState(task?.timezone ?? "Asia/Shanghai");
  const [contentMode, setContentMode] = useState<ContentMode>(mode === "create" || task?.contentMode === "platform" ? "platform" : "loop_managed");
  const [contentMarkdown, setContentMarkdown] = useState((mode === "create" || task?.contentMode === "platform") ? task?.contentMarkdown ?? "" : "");
  const [executionTarget, setExecutionTarget] = useState(initialTarget ? targetValue(initialTarget) : "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const title = mode === "create" ? "新建定时任务" : "编辑定时任务";
  const selectedLoop = enabledLoops.find((option) => option.id === loopBindingId) ?? null;
  const compatibleTargetOptions = useMemo(
    () => targetsForLoop(enabledLoops, loopBindingId, targetOptions),
    [enabledLoops, loopBindingId, targetOptions],
  );
  const selectedTargetOptions = useMemo(() => (
    mode === "edit" && storedTarget && !compatibleTargetOptions.some((option) => targetValue(option) === targetValue(storedTarget))
      ? [storedTarget, ...compatibleTargetOptions]
      : compatibleTargetOptions
  ), [compatibleTargetOptions, mode, storedTarget]);
  const selectedTarget = selectedTargetOptions.find((option) => targetValue(option) === executionTarget) ?? null;
  const cronPreview = useMemo(() => previewNextOccurrence(cronExpression, timezone), [cronExpression, timezone]);

  function changeContentMode(nextMode: ContentMode) {
    if (nextMode !== contentMode) setContentMarkdown("");
    setContentMode(nextMode);
    setError(null);
  }

  async function submit() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("请填写任务名称");
      return;
    }
    if (!selectedLoop) {
      setError(unavailableLoop ? "原 Loop 已不再启用或可用，请选择当前启用 Loop" : "请选择已启用的 Loop");
      return;
    }
    if (!cronExpression.trim() || !timezone.trim()) {
      setError("请填写 Cron 和时区");
      return;
    }
    if (!selectedTarget) {
      setError("请选择执行目标");
      return;
    }
    if (!selectedTarget.ready) {
      setError("原执行目标已不可用，请重新选择当前 Loop 支持的执行目标");
      return;
    }
    if (contentMode === "platform" && !contentMarkdown.trim()) {
      setError("平台维护模式需要任务正文");
      return;
    }

    setPending(true);
    setError(null);
    try {
      const payload = {
        commandId: commandId(),
        name: trimmedName,
        description: description.trim(),
        loopBindingId: selectedLoop.id,
        cronExpression: cronExpression.trim(),
        timezone: timezone.trim(),
        contentMode,
        ...(contentMode === "platform"
          ? { contentMarkdown }
          : mode === "edit"
            ? { contentMarkdown: null }
            : {}),
        executionTarget: inputTarget(selectedTarget),
      };
      const url = mode === "create"
        ? `/api/projects/${encodeURIComponent(projectId)}/scheduled-tasks`
        : `/api/projects/${encodeURIComponent(projectId)}/scheduled-tasks/${encodeURIComponent(task?.id ?? "")}`;
      const response = await fetch(url, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(mode === "edit"
          ? { ...payload, expectedVersion: task?.version }
          : payload),
      });
      const result = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error ?? "保存失败");
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
    } finally {
      setPending(false);
    }
  }

  function closeDialog() {
    if (onCancel) onCancel();
    else onSaved();
  }

  return (
    <Dialog.Root open onOpenChange={(nextOpen) => {
      if (!nextOpen && !pending) closeDialog();
    }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-[#24292f66]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[70] max-h-[calc(100vh-1.5rem)] w-[calc(100%-1.5rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-lg border border-[#d0d7de] bg-white shadow-xl outline-none sm:max-h-[calc(100vh-2rem)] sm:w-[calc(100%-2rem)]">
        <header className="flex items-center justify-between gap-3 border-b border-[#d0d7de] bg-[#f6f8fa] px-4 py-3">
          <div>
            <Dialog.Title className="text-sm font-semibold text-[#24292f]">{title}</Dialog.Title>
            <Dialog.Description className="sr-only">配置定时任务的调度、Loop、内容来源和执行目标。</Dialog.Description>
          </div>
          <button
            type="button"
            aria-label={`关闭${title}`}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-[#57606a] hover:bg-white hover:text-[#24292f]"
            onClick={closeDialog}
          >
            <X aria-hidden="true" size={16} />
          </button>
        </header>

        <form
          className="grid max-h-[calc(100vh-2rem)] gap-5 overflow-y-auto px-4 py-4 sm:px-5"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid min-w-0 gap-1.5 text-sm font-semibold text-[#24292f]">
              名称
              <input
                aria-label="名称"
                value={name}
                maxLength={191}
                onChange={(event) => {
                  setName(event.currentTarget.value);
                  setError(null);
                }}
                className="min-h-9 min-w-0 rounded-md border border-[#8c959f] px-3 py-2 text-sm font-normal text-[#24292f] outline-none focus:border-[#0969da] focus:ring-4 focus:ring-[#0969da]/10"
              />
            </label>
            <label className="grid min-w-0 gap-1.5 text-sm font-semibold text-[#24292f]">
              说明
              <textarea
                aria-label="说明"
                value={description}
                maxLength={10_000}
                rows={2}
                onChange={(event) => setDescription(event.currentTarget.value)}
                className="min-h-[58px] min-w-0 resize-y rounded-md border border-[#8c959f] px-3 py-2 text-sm font-normal text-[#24292f] outline-none focus:border-[#0969da] focus:ring-4 focus:ring-[#0969da]/10"
              />
            </label>
          </div>

          <fieldset className="grid min-w-0 gap-2">
            <legend className="text-sm font-semibold text-[#24292f]">Loop</legend>
            {unavailableLoop ? (
              <p role="alert" className="rounded-md border border-[#f1aeb5] bg-[#fff5f5] px-3 py-2 text-xs leading-5 text-[#cf222e]">
                原 Loop“{unavailableLoop.name}”已不再启用或可用，请选择当前启用的 Loop 后再保存。
              </p>
            ) : null}
            {enabledLoops.length === 0 ? (
              <p className="rounded-md border border-[#d4a72c66] bg-[#fff8c5] px-3 py-2 text-xs leading-5 text-[#7d4e00]">当前项目没有已启用的可用 Loop。</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {enabledLoops.map((option) => (
                  <label key={option.id} className="flex min-w-0 cursor-pointer items-start gap-2 rounded-md border border-[#d0d7de] px-3 py-2 text-sm text-[#24292f] hover:bg-[#f6f8fa]">
                    <input
                      type="radio"
                      name="scheduled-task-loop"
                      value={option.id}
                      checked={loopBindingId === option.id}
                      onChange={() => {
                        setLoopBindingId(option.id);
                        setExecutionTarget("");
                        setError(null);
                      }}
                      className="mt-1"
                    />
                    <span className="min-w-0">
                      <span className="mr-2 rounded-full border border-[#d0d7de] bg-white px-2 py-0.5 text-[11px] font-semibold text-[#57606a]">{scopeLabel(option.scope)}</span>
                      <span className="break-words font-semibold">{option.name}</span>
                      <span className="mt-1 block text-xs text-[#57606a]">v{option.versionNumber}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
            <label className="grid min-w-0 gap-1.5 text-sm font-semibold text-[#24292f]">
              Cron
              <input
                aria-label="Cron"
                value={cronExpression}
                maxLength={191}
                spellCheck={false}
                onChange={(event) => setCronExpression(event.currentTarget.value)}
                className="min-h-9 min-w-0 rounded-md border border-[#8c959f] px-3 py-2 font-mono text-sm font-normal text-[#24292f] outline-none focus:border-[#0969da] focus:ring-4 focus:ring-[#0969da]/10"
              />
            </label>
            <label className="grid min-w-0 gap-1.5 text-sm font-semibold text-[#24292f]">
              时区
              <input
                aria-label="时区"
                value={timezone}
                maxLength={64}
                spellCheck={false}
                onChange={(event) => setTimezone(event.currentTarget.value)}
                className="min-h-9 min-w-0 rounded-md border border-[#8c959f] px-3 py-2 text-sm font-normal text-[#24292f] outline-none focus:border-[#0969da] focus:ring-4 focus:ring-[#0969da]/10"
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-[#57606a]">
            <span className="font-semibold text-[#24292f]">常用示例</span>
            {CRON_EXAMPLES.map((example) => (
              <button
                key={example.expression}
                type="button"
                className="rounded border border-[#d0d7de] bg-white px-2 py-1 font-mono hover:bg-[#f6f8fa]"
                onClick={() => {
                  setCronExpression(example.expression);
                  setTimezone(example.timezone);
                  setError(null);
                }}
              >
                {example.label} {example.expression}
              </button>
            ))}
            <span role="status">下次预览：{cronPreview ?? "Cron 或时区无效"}</span>
          </div>

          <fieldset className="grid gap-2">
            <legend className="text-sm font-semibold text-[#24292f]">内容来源</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex cursor-pointer items-start gap-2 rounded-md border border-[#d0d7de] px-3 py-2 text-sm text-[#24292f] hover:bg-[#f6f8fa]">
                <input type="radio" name="scheduled-task-content-mode" checked={contentMode === "platform"} onChange={() => changeContentMode("platform")} className="mt-1" />
                <span><span className="font-semibold">平台维护</span><span className="mt-1 block text-xs leading-5 text-[#57606a]">保存正文并在运行时提供固定快照</span></span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 rounded-md border border-[#d0d7de] px-3 py-2 text-sm text-[#24292f] hover:bg-[#f6f8fa]">
                <input type="radio" name="scheduled-task-content-mode" checked={contentMode === "loop_managed"} onChange={() => changeContentMode("loop_managed")} className="mt-1" />
                <span><span className="font-semibold">项目自行管理</span><span className="mt-1 block text-xs leading-5 text-[#57606a]">Loop 从项目侧读取内容</span></span>
              </label>
            </div>
            <p className="text-xs leading-5 text-[#cf222e]">平台维护：任务正文会上传到 HumanThread，并在每次执行时由 Worker / Local Agent 从平台读取固定快照。请勿填写密码、Token、Cookie、密钥或受监管个人信息。</p>
            <p className="text-xs leading-5 text-[#cf222e]">项目自行管理：平台只保存调度和 Loop 绑定，不保存任务正文；正文需放在项目仓库或项目配置中，由 Loop 自行读取。内容未就绪时，本次运行会按 Loop 逻辑失败或等待。</p>
          </fieldset>

          {contentMode === "platform" ? (
            <label className="grid gap-1.5 text-sm font-semibold text-[#24292f]">
              任务正文
              <textarea
                aria-label="任务正文"
                value={contentMarkdown}
                maxLength={100_000}
                rows={7}
                onChange={(event) => {
                  setContentMarkdown(event.currentTarget.value);
                  setError(null);
                }}
                className="min-h-36 resize-y rounded-md border border-[#8c959f] px-3 py-2 font-mono text-sm font-normal leading-6 text-[#24292f] outline-none focus:border-[#0969da] focus:ring-4 focus:ring-[#0969da]/10"
              />
            </label>
          ) : null}

          <fieldset className="grid gap-2">
            <legend className="text-sm font-semibold text-[#24292f]">执行目标</legend>
            {selectedTargetOptions.length === 0 ? (
              <p className="rounded-md border border-[#d4a72c66] bg-[#fff8c5] px-3 py-2 text-xs leading-5 text-[#7d4e00]">当前 Loop 没有兼容的执行目标。</p>
            ) : (
              <div className="grid gap-2">
                {selectedTargetOptions.map((option) => (
                  <label key={targetValue(option)} className="flex min-w-0 cursor-pointer items-start gap-2 rounded-md border border-[#d0d7de] px-3 py-2 text-sm text-[#24292f] hover:bg-[#f6f8fa]">
                    <input
                      type="radio"
                      name="scheduled-task-execution-target"
                      value={targetValue(option)}
                      checked={executionTarget === targetValue(option)}
                      onChange={() => {
                        setExecutionTarget(targetValue(option));
                        setError(null);
                      }}
                      className="mt-1"
                    />
                    <span className="min-w-0">
                      <span className="break-words font-semibold">{option.displayName}</span>
                      <span className="mt-1 block text-xs leading-5 text-[#57606a]">{targetTypeLabel(option.type)} · {option.ready ? "当前可用" : option.reason ?? "当前不可用"}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>

          {error ? <div role="alert" className="rounded-md border border-[#f1aeb5] bg-[#fff5f5] px-3 py-2 text-sm text-[#cf222e]">{error}</div> : null}

          <div className="flex flex-wrap justify-end gap-2 border-t border-[#d8dee4] pt-4">
            <WorkbenchButton type="button" disabled={pending} onClick={closeDialog}>取消</WorkbenchButton>
            <WorkbenchButton type="submit" variant="primary" disabled={pending || !selectedLoop} className="disabled:cursor-not-allowed disabled:opacity-50">{pending ? "保存中" : "保存任务"}</WorkbenchButton>
          </div>
        </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function targetValue(option: { type: "local_agent" | "linux_worker_pool"; id: string }): string {
  return `${option.type}:${option.id}`;
}

function targetsForLoop(
  loopOptions: LoopOption[],
  loopBindingId: string,
  fallback: ProjectScheduledTaskTargetOption[],
): ProjectScheduledTaskTargetOption[] {
  const loop = loopOptions.find((option) => option.id === loopBindingId);
  return loop?.targetOptions ?? fallback.filter((option) => (
    option.loopBindingIds.length === 0 || option.loopBindingIds.includes(loopBindingId)
  ));
}

const CRON_EXAMPLES = [
  { label: "每天 9 点", expression: "0 9 * * *", timezone: "Asia/Shanghai" },
  { label: "每小时", expression: "0 * * * *", timezone: "Asia/Shanghai" },
  { label: "工作日 9 点", expression: "0 9 * * 1-5", timezone: "Asia/Shanghai" },
] as const;

function previewNextOccurrence(cronExpression: string, timezone: string): string | null {
  try {
    const next = calculateNextScheduledTaskOccurrence({
      rule: cronExpression,
      timezone,
      after: new Date(),
    });
    return new Intl.DateTimeFormat("zh-CN", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timezone,
    }).format(next);
  } catch {
    return null;
  }
}

function inputTarget(option: ProjectScheduledTaskTargetOption) {
  return option.type === "local_agent"
    ? { type: "local_agent" as const, agentProfileId: option.id }
    : { type: "linux_worker_pool" as const, workerPoolId: option.id };
}

function targetTypeLabel(type: "local_agent" | "linux_worker_pool"): string {
  return type === "local_agent" ? "Local Agent" : "Worker Pool";
}

function scopeLabel(scope: "project" | "task"): string {
  return scope === "project" ? "项目级" : "任务级";
}

function commandId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `scheduled-task-${Date.now().toString(36)}`;
}
