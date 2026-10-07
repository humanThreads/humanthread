"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { createTaskCommandId } from "../../../lib/tasks/task-command-id";

export interface TaskCreateSpaceOption {
  id: string;
  name: string;
  type: "personal" | "company";
}

export interface TaskCreateProjectOption {
  id: string;
  name: string;
  spaceId: string;
  milestones: Array<{ id: string; name: string }>;
}

interface TaskCreateResponse {
  ok: boolean;
  result?: { taskId: string; version: number };
  error?: string;
  issues?: Array<{ path?: Array<string | number>; message?: string }>;
}

interface TaskCreateDialogProps {
  open: boolean;
  spaces: TaskCreateSpaceOption[];
  projects?: TaskCreateProjectOption[];
  initialSpaceId?: string;
  initialProjectId?: string;
  initialStatusLabel?: string;
  onOpenChange(open: boolean): void;
  onCreated(result: { taskId: string; version: number }): void;
}

function dateTimeIso(value: string) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function TaskCreateDialog({
  open,
  spaces,
  projects = [],
  initialSpaceId,
  initialProjectId,
  initialStatusLabel = "待处理",
  onOpenChange,
  onCreated,
}: TaskCreateDialogProps) {
  const defaultSpaceId = spaces.some((space) => space.id === initialSpaceId)
    ? initialSpaceId!
    : spaces[0]?.id ?? "";
  const defaultProjectId = projects.some((project) => (
    project.id === initialProjectId && project.spaceId === defaultSpaceId
  )) ? initialProjectId! : "";
  const [title, setTitle] = useState("");
  const [spaceId, setSpaceId] = useState(defaultSpaceId);
  const [projectId, setProjectId] = useState(defaultProjectId);
  const [milestoneId, setMilestoneId] = useState("");
  const [priority, setPriority] = useState("0");
  const [dueAt, setDueAt] = useState("");
  const [startAt, setStartAt] = useState("");
  const [acceptanceMode, setAcceptanceMode] = useState("none");
  const [requiredChecksText, setRequiredChecksText] = useState("delivery");
  const [visibility, setVisibility] = useState(defaultProjectId ? "project" : "company");
  const [contentMarkdown, setContentMarkdown] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const selectedSpace = spaces.find((space) => space.id === spaceId) ?? null;
  const availableProjects = useMemo(
    () => projects.filter((project) => project.spaceId === spaceId),
    [projects, spaceId],
  );
  const selectedProject = availableProjects.find((project) => project.id === projectId) ?? null;
  const dirty = Boolean(title || contentMarkdown || priority !== "0" || dueAt || startAt || milestoneId)
    || spaceId !== defaultSpaceId
    || projectId !== defaultProjectId
    || acceptanceMode !== "none"
    || requiredChecksText !== "delivery";

  function requestClose() {
    if (pending) return;
    if (dirty) {
      setDiscardOpen(true);
      return;
    }
    onOpenChange(false);
  }

  function changeSpace(nextSpaceId: string) {
    setSpaceId(nextSpaceId);
    setProjectId("");
    setMilestoneId("");
    setAcceptanceMode("none");
    setVisibility("company");
    setErrors({});
  }

  function changeProject(nextProjectId: string) {
    setProjectId(nextProjectId);
    setMilestoneId("");
    if (nextProjectId) {
      setVisibility("project");
    } else {
      setAcceptanceMode("none");
    }
    setErrors({});
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (!title.trim()) {
      setErrors({ title: "请输入任务标题" });
      return;
    }
    if (!selectedSpace) {
      setErrors({ form: "请选择可用的工作空间" });
      return;
    }
    const requiredChecks = [...new Set(requiredChecksText.split(",").map((value) => value.trim()).filter(Boolean))];
    if ((acceptanceMode === "automated" || acceptanceMode === "hybrid") && requiredChecks.length === 0) {
      setErrors({ requiredChecks: "请至少填写一项必需检查" });
      return;
    }
    setPending(true);
    setErrors({});
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          commandId: createTaskCommandId(),
          spaceId: selectedSpace.id,
          title: title.trim(),
          ...(contentMarkdown ? { contentMarkdown } : {}),
          ...(selectedProject ? { projectId: selectedProject.id } : {}),
          ...(milestoneId ? { milestoneId } : {}),
          visibility: selectedSpace.type === "personal"
            ? "private"
            : selectedProject
              ? "project"
              : visibility,
          priority: Number(priority),
          ...(dateTimeIso(startAt) ? { startAt: dateTimeIso(startAt) } : {}),
          ...(dateTimeIso(dueAt) ? { dueAt: dateTimeIso(dueAt) } : {}),
          acceptanceMode,
          ...((acceptanceMode === "automated" || acceptanceMode === "hybrid") ? { requiredChecks } : {}),
        }),
      });
      const body = await response.json() as TaskCreateResponse;
      if (!response.ok || !body.ok || !body.result) {
        const fieldErrors = Object.fromEntries((body.issues ?? []).flatMap((issue) => {
          const field = issue.path?.[0];
          return typeof field === "string" && issue.message ? [[field, issue.message]] : [];
        }));
        setErrors(Object.keys(fieldErrors).length ? fieldErrors : { form: body.error ?? "任务创建失败" });
        return;
      }
      onCreated(body.result);
      onOpenChange(false);
    } catch {
      setErrors({ form: "网络异常，请稍后重试" });
    } finally {
      setPending(false);
    }
  }

  const inputClass = "h-10 rounded-md border border-[#8c959f] bg-white px-3 text-sm font-normal outline-none focus:border-[#0969da] focus:ring-4 focus:ring-[#0969da]/10";

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen) requestClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[#1f2328]/45" />
        <Dialog.Content
          aria-busy={pending}
          onEscapeKeyDown={(event) => { event.preventDefault(); requestClose(); }}
          onPointerDownOutside={(event) => { event.preventDefault(); requestClose(); }}
          className="fixed inset-x-0 bottom-0 z-50 max-h-[92vh] overflow-y-auto border border-[#d0d7de] bg-white shadow-[0_24px_60px_rgba(31,35,40,0.24)] outline-none sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:w-[min(94vw,620px)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg"
        >
          <form onSubmit={(event) => void submit(event)}>
            <div className="flex items-start gap-3 border-b border-[#d0d7de] px-5 py-4">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[#ddf4ff] text-[#0550ae]"><Plus size={18} /></div>
              <div className="min-w-0 flex-1">
                <Dialog.Title className="text-base font-semibold text-[#24292f]">新建任务</Dialog.Title>
                <Dialog.Description className="mt-1 text-sm text-[#57606a]">创建个人或公司空间任务</Dialog.Description>
              </div>
              <button type="button" disabled={pending} onClick={requestClose} className="grid h-8 w-8 place-items-center rounded-md text-[#57606a] hover:bg-[#f6f8fa] disabled:opacity-50" aria-label="关闭新建任务弹窗" title="关闭"><X size={17} /></button>
            </div>

            <div className="grid gap-4 px-5 py-5">
              {errors.form ? <div role="alert" className="rounded-md border border-[#f1aeb5] bg-[#fff5f5] px-3 py-2 text-sm text-[#cf222e]">{errors.form}</div> : null}
              <label className="grid gap-1.5 text-sm font-semibold text-[#24292f]">
                任务标题
                <input autoFocus aria-label="任务标题" value={title} onChange={(event) => { setTitle(event.target.value); setErrors({}); }} className={inputClass} />
                {errors.title ? <span role="alert" className="text-xs text-[#cf222e]">{errors.title}</span> : null}
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-1.5 text-sm font-semibold text-[#24292f]">
                  工作空间
                  <select aria-label="工作空间" value={spaceId} onChange={(event) => changeSpace(event.target.value)} className={inputClass}>
                    {spaces.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}
                  </select>
                </label>
                <label className="grid gap-1.5 text-sm font-semibold text-[#24292f]">
                  项目
                  <select aria-label="项目" value={projectId} onChange={(event) => changeProject(event.target.value)} className={inputClass}>
                    <option value="">不关联项目</option>
                    {availableProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                  </select>
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="grid gap-1.5 text-sm font-semibold text-[#24292f]">
                  状态
                  <div className="flex h-10 items-center rounded-md border border-[#d0d7de] bg-[#f6f8fa] px-3 font-normal"><span className="mr-2 h-2 w-2 rounded-full bg-[#1f883d]" />{initialStatusLabel}</div>
                </div>
                <label className="grid gap-1.5 text-sm font-semibold text-[#24292f]">
                  优先级
                  <select aria-label="优先级" value={priority} onChange={(event) => setPriority(event.target.value)} className={inputClass}>
                    <option value="0">普通</option><option value="1">较高</option><option value="2">高</option><option value="3">紧急</option>
                  </select>
                </label>
                <label className="grid gap-1.5 text-sm font-semibold text-[#24292f]">
                  截止时间
                  <input type="datetime-local" aria-label="截止时间" value={dueAt} onChange={(event) => setDueAt(event.target.value)} className={inputClass} />
                </label>
              </div>

              {selectedProject?.milestones.length ? (
                <label className="grid gap-1.5 text-sm font-semibold text-[#24292f]">
                  里程碑
                  <select aria-label="里程碑" value={milestoneId} onChange={(event) => setMilestoneId(event.target.value)} className={inputClass}>
                    <option value="">不关联里程碑</option>
                    {selectedProject.milestones.map((milestone) => <option key={milestone.id} value={milestone.id}>{milestone.name}</option>)}
                  </select>
                </label>
              ) : null}

              {selectedSpace?.type === "personal" ? (
                <div className="rounded-md border border-[#d0d7de] bg-[#f6f8fa] px-3 py-2 text-sm text-[#57606a]">个人任务仅自己可见</div>
              ) : !selectedProject ? (
                <label className="grid gap-1.5 text-sm font-semibold text-[#24292f]">
                  可见范围
                  <select aria-label="可见范围" value={visibility} onChange={(event) => setVisibility(event.target.value)} className={inputClass}>
                    <option value="company">公司成员</option><option value="private">仅任务成员</option>
                  </select>
                </label>
              ) : null}

              <button type="button" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen((value) => !value)} className="flex h-9 items-center justify-between rounded-md border border-[#d0d7de] px-3 text-sm font-semibold text-[#24292f] hover:bg-[#f6f8fa]">
                <span>更多设置</span>{advancedOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
              {advancedOpen ? (
                <div className="grid gap-4 border-t border-[#d8dee4] pt-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="grid gap-1.5 text-sm font-semibold text-[#24292f]">开始时间<input type="datetime-local" aria-label="开始时间" value={startAt} onChange={(event) => setStartAt(event.target.value)} className={inputClass} /></label>
                    <label className="grid gap-1.5 text-sm font-semibold text-[#24292f]">验收方式<select aria-label="验收方式" value={acceptanceMode} onChange={(event) => { setAcceptanceMode(event.target.value); setErrors({}); }} className={inputClass}><option value="none">无需验收</option><option value="human">人工验收</option><option value="automated" disabled={!selectedProject}>自动检查</option><option value="hybrid" disabled={!selectedProject}>人工与自动</option></select></label>
                  </div>
                  {acceptanceMode === "automated" || acceptanceMode === "hybrid" ? (
                    <label className="grid gap-1.5 text-sm font-semibold text-[#24292f]">
                      必需检查
                      <input aria-label="必需检查" value={requiredChecksText} onChange={(event) => { setRequiredChecksText(event.target.value); setErrors({}); }} className={inputClass} />
                      <span className="text-xs font-normal text-[#57606a]">多个检查使用英文逗号分隔</span>
                      {errors.requiredChecks ? <span role="alert" className="text-xs text-[#cf222e]">{errors.requiredChecks}</span> : null}
                    </label>
                  ) : null}
                  <label className="grid gap-1.5 text-sm font-semibold text-[#24292f]">任务正文<textarea aria-label="任务正文" value={contentMarkdown} onChange={(event) => setContentMarkdown(event.target.value)} rows={5} className="resize-y rounded-md border border-[#8c959f] px-3 py-2 font-mono text-sm font-normal outline-none focus:border-[#0969da] focus:ring-4 focus:ring-[#0969da]/10" /></label>
                </div>
              ) : null}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-[#d0d7de] bg-[#fbfcfd] px-5 py-3">
              <button type="button" disabled={pending} onClick={requestClose} className="h-9 rounded-md border border-[#d0d7de] bg-white px-3 text-sm font-semibold text-[#24292f] hover:bg-[#f6f8fa] disabled:opacity-50">取消</button>
              <button type="submit" disabled={pending || spaces.length === 0} className="h-9 rounded-md bg-[#1f883d] px-4 text-sm font-semibold text-white hover:bg-[#1a7f37] disabled:opacity-50">{pending ? "创建中" : "创建任务"}</button>
            </div>
          </form>

          {discardOpen ? (
            <div className="absolute inset-0 z-10 grid place-items-center bg-white/90 p-5">
              <div role="alertdialog" aria-labelledby="discard-task-title" className="w-full max-w-sm rounded-lg border border-[#d0d7de] bg-white p-5 shadow-xl">
                <h3 id="discard-task-title" className="text-base font-semibold text-[#24292f]">放弃当前编辑？</h3>
                <p className="mt-2 text-sm text-[#57606a]">尚未创建的任务内容将被清空。</p>
                <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setDiscardOpen(false)} className="h-9 rounded-md border border-[#d0d7de] px-3 text-sm font-semibold">继续编辑</button><button type="button" onClick={() => onOpenChange(false)} className="h-9 rounded-md bg-[#cf222e] px-3 text-sm font-semibold text-white">放弃编辑</button></div>
              </div>
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
