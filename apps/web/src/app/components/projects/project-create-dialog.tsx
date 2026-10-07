"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { FolderKanban, X } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { DevelopmentTemplateLoopPreviews, normalizeDevelopmentTemplateLoopVersions, type DevelopmentTemplateLoopPreview } from "./development-template-loop-previews";
import type { LoopGroupPreset } from "@humanthread/shared";

export interface ProjectCreateSpaceOption {
  id: string;
  name: string;
  type: "personal" | "company";
}

export interface ProjectCreateManagerOption {
  id: string;
  name: string;
  spaceId: string;
}

interface DevelopmentTemplateOption {
  key: string;
  kind: string;
  name: string;
  version: number;
  description?: string | null;
  developmentLoopVersionId?: string | null;
  releaseLoopVersionId?: string | null;
  loopGroupConfig?: { presets: LoopGroupPreset[]; defaultSelection: { selectedPresetKeys: string[]; defaultPresetKey: string } } | null;
}

interface ReleaseAgentProfileOption {
  id: string;
  name: string;
  provider: string;
}

export function resolveLoopGroupSelection(input: {
  presets: readonly { key: string }[];
  defaultSelection?: { selectedPresetKeys: readonly string[]; defaultPresetKey: string };
}) {
  const available = input.presets.map((preset) => preset.key);
  const selected = input.defaultSelection?.selectedPresetKeys.filter((key) => available.includes(key))
    ?? (available[0] ? [available[0]] : []);
  return {
    selectedPresetKeys: selected,
    defaultPresetKey: input.defaultSelection?.defaultPresetKey && selected.includes(input.defaultSelection.defaultPresetKey)
      ? input.defaultSelection.defaultPresetKey
      : selected[0] ?? "",
  };
}

export function ProjectCreateDialog({ open, spaces, managers, initialSpaceId, onOpenChange, onCreated }: {
  open: boolean;
  spaces: readonly ProjectCreateSpaceOption[];
  managers: readonly ProjectCreateManagerOption[];
  initialSpaceId?: string;
  onOpenChange(open: boolean): void;
  onCreated(result: { projectId: string; version: number }): void;
}) {
  const defaultSpaceId = spaces.some((space) => space.id === initialSpaceId) ? initialSpaceId! : spaces[0]?.id ?? "";
  const defaultManagerId = managers.find((manager) => manager.spaceId === defaultSpaceId)?.id ?? "";
  const [spaceId, setSpaceId] = useState(defaultSpaceId);
  const [managerUserId, setManagerUserId] = useState(defaultManagerId);
  const [name, setName] = useState("");
  const [shortCode, setShortCode] = useState("");
  const [objective, setObjective] = useState("");
  const [startAt, setStartAt] = useState("");
  const [targetAt, setTargetAt] = useState("");
  const [developmentTemplates, setDevelopmentTemplates] = useState<DevelopmentTemplateOption[]>([]);
  const [loopVersions, setLoopVersions] = useState<DevelopmentTemplateLoopPreview[]>([]);
  const [releaseAgentProfiles, setReleaseAgentProfiles] = useState<ReleaseAgentProfileOption[]>([]);
  const [developmentTemplate, setDevelopmentTemplate] = useState("");
  const [productionBranch, setProductionBranch] = useState("");
  const [stagingBranch, setStagingBranch] = useState("");
  const [releaseAgentProfileId, setReleaseAgentProfileId] = useState("");
  const [selectedPresetKeys, setSelectedPresetKeys] = useState<string[]>([]);
  const [defaultPresetKey, setDefaultPresetKey] = useState("");
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const availableManagers = useMemo(() => managers.filter((manager) => manager.spaceId === spaceId), [managers, spaceId]);
  const developmentModesEnabled = process.env.NEXT_PUBLIC_HUMANTHREAD_DEVELOPMENT_MODES === "true";
  const selectedDevelopmentTemplate = developmentTemplates.find((template) => `${template.key}:${template.version}` === developmentTemplate);

  function selectDevelopmentTemplate(value: string) {
    setDevelopmentTemplate(value);
    const template = developmentTemplates.find((candidate) => `${candidate.key}:${candidate.version}` === value);
    const selection = template?.loopGroupConfig ? resolveLoopGroupSelection(template.loopGroupConfig) : { selectedPresetKeys: [], defaultPresetKey: "" };
    setSelectedPresetKeys(selection.selectedPresetKeys);
    setDefaultPresetKey(selection.defaultPresetKey);
    setErrors({});
  }

  useEffect(() => {
    if (!open || !developmentModesEnabled || !spaceId) return;
    const controller = new AbortController();
    void fetch(`/api/development-templates?spaceId=${encodeURIComponent(spaceId)}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as {
          ok: boolean;
          result?: { templates: DevelopmentTemplateOption[]; loopVersions?: DevelopmentTemplateLoopPreview[]; agentProfiles: ReleaseAgentProfileOption[] };
        };
        if (!response.ok || !body.ok || !body.result) throw new Error("Development templates unavailable");
        setDevelopmentTemplates(body.result.templates);
        setLoopVersions(normalizeDevelopmentTemplateLoopVersions(body.result.loopVersions));
        setReleaseAgentProfiles(body.result.agentProfiles);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setDevelopmentTemplates([]);
        setLoopVersions([]);
        setReleaseAgentProfiles([]);
        setErrors((current) => ({ ...current, developmentTemplate: "开发模式加载失败" }));
      });
    return () => controller.abort();
  }, [developmentModesEnabled, open, spaceId]);

  function changeSpace(nextSpaceId: string) {
    setSpaceId(nextSpaceId);
    setManagerUserId(managers.find((manager) => manager.spaceId === nextSpaceId)?.id ?? "");
    setDevelopmentTemplate("");
    setLoopVersions([]);
    setReleaseAgentProfileId("");
    setSelectedPresetKeys([]);
    setDefaultPresetKey("");
    setErrors({});
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (!name.trim() || !objective.trim() || !spaceId || !managerUserId) {
      setErrors({ form: "请填写项目名称、目标、空间和负责人" });
      return;
    }
    if (startAt && targetAt && targetAt < startAt) {
      setErrors({ targetAt: "目标日期不能早于开始日期" });
      return;
    }
    if (selectedDevelopmentTemplate && (!productionBranch.trim() || !stagingBranch.trim() || !releaseAgentProfileId)) {
      setErrors({ developmentTemplate: "请填写生产分支、预发分支和发版 Agent" });
      return;
    }
    if (selectedDevelopmentTemplate && productionBranch.trim() === stagingBranch.trim()) {
      setErrors({ stagingBranch: "预发分支不能与生产分支相同" });
      return;
    }
    setPending(true);
    setErrors({});
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          spaceId,
          name: name.trim(),
          ...(shortCode.trim() ? { shortCode: shortCode.trim().toUpperCase() } : {}),
          objective: objective.trim(),
          managerUserId,
          ...(startAt ? { startAt: new Date(`${startAt}T00:00:00`).toISOString() } : {}),
          ...(targetAt ? { targetAt: new Date(`${targetAt}T23:59:59`).toISOString() } : {}),
          ...(selectedDevelopmentTemplate ? {
            developmentTemplateKey: selectedDevelopmentTemplate.key,
            developmentTemplateVersion: selectedDevelopmentTemplate.version,
            developmentTemplateConfig: {
              productionBranch: productionBranch.trim(),
              stagingBranch: stagingBranch.trim(),
              releaseAgentProfileId,
              taskBranchPattern: "{year}-{shortId}",
              ...(selectedDevelopmentTemplate.loopGroupConfig ? { loopGroupSelection: { selectedPresetKeys, defaultPresetKey } } : {}),
            },
          } : {}),
        }),
      });
      const body = await response.json() as { ok: boolean; result?: { projectId: string; version: number }; error?: string; issues?: Array<{ path?: Array<string | number>; message?: string }> };
      if (!response.ok || !body.ok || !body.result) {
        const fieldErrors = Object.fromEntries((body.issues ?? []).flatMap((issue) => typeof issue.path?.[0] === "string" && issue.message ? [[issue.path[0], issue.message]] : []));
        setErrors(Object.keys(fieldErrors).length ? fieldErrors : { form: body.error ?? "项目创建失败" });
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
    <Dialog.Root open={open} onOpenChange={(next) => { if (!pending) onOpenChange(next); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[#1f2328]/45" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 max-h-[92vh] overflow-y-auto border border-[#d0d7de] bg-white shadow-[0_24px_60px_rgba(31,35,40,0.24)] outline-none sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:w-[min(94vw,620px)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg">
          <form onSubmit={(event) => void submit(event)}>
            <div className="flex items-start gap-3 border-b border-[#d0d7de] px-5 py-4">
              <div className="grid h-9 w-9 place-items-center rounded-md bg-[#ddf4ff] text-[#0550ae]"><FolderKanban size={18} /></div>
              <div className="min-w-0 flex-1"><Dialog.Title className="text-base font-semibold">新建项目</Dialog.Title><Dialog.Description className="mt-1 text-sm text-[#57606a]">先定义交付目标与负责人，路线图可以稍后完善</Dialog.Description></div>
              <Dialog.Close disabled={pending} className="grid h-8 w-8 place-items-center rounded-md text-[#57606a] hover:bg-[#f6f8fa]" aria-label="关闭新建项目弹窗"><X size={17} /></Dialog.Close>
            </div>
            <div className="grid gap-4 px-5 py-5">
              {errors.form ? <div role="alert" className="rounded-md border border-[#f1aeb5] bg-[#fff5f5] px-3 py-2 text-sm text-[#cf222e]">{errors.form}</div> : null}
              <label className="grid gap-1.5 text-sm font-semibold">项目名称<input autoFocus aria-label="项目名称" value={name} onChange={(event) => setName(event.target.value)} className={inputClass} /></label>
              <label className="grid gap-1.5 text-sm font-semibold">项目简称<input aria-label="项目简称" value={shortCode} onChange={(event) => setShortCode(event.target.value.replace(/[^a-z0-9]/giu, "").slice(0, 12))} placeholder="例如 HT" className={inputClass} />{errors.shortCode ? <span role="alert" className="text-xs text-[#cf222e]">{errors.shortCode}</span> : null}</label>
              <label className="grid gap-1.5 text-sm font-semibold">项目目标<textarea aria-label="项目目标" value={objective} onChange={(event) => setObjective(event.target.value)} rows={4} className="resize-y rounded-md border border-[#8c959f] px-3 py-2 text-sm font-normal outline-none focus:border-[#0969da] focus:ring-4 focus:ring-[#0969da]/10" /></label>
              <div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-1.5 text-sm font-semibold">工作空间<select aria-label="工作空间" value={spaceId} onChange={(event) => changeSpace(event.target.value)} className={inputClass}>{spaces.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}</select></label><label className="grid gap-1.5 text-sm font-semibold">项目负责人<select aria-label="项目负责人" value={managerUserId} onChange={(event) => setManagerUserId(event.target.value)} className={inputClass}>{availableManagers.map((manager) => <option key={manager.id} value={manager.id}>{manager.name}</option>)}</select></label></div>
              {developmentModesEnabled ? <div className="grid gap-4 border-t border-[#d8dee4] pt-4">
                <label className="grid gap-1.5 text-sm font-semibold">开发模式<select aria-label="开发模式" value={developmentTemplate} onChange={(event) => selectDevelopmentTemplate(event.target.value)} className={inputClass}><option value="">不配置</option>{developmentTemplates.map((template) => <option key={`${template.key}:${template.version}`} value={`${template.key}:${template.version}`}>{template.name}</option>)}</select>{errors.developmentTemplate ? <span role="alert" className="text-xs text-[#cf222e]">{errors.developmentTemplate}</span> : null}</label>
                {selectedDevelopmentTemplate ? <DevelopmentTemplateLoopPreviews template={selectedDevelopmentTemplate} loopVersions={loopVersions} /> : null}
                {selectedDevelopmentTemplate?.kind === "branch-development" ? <><p className="text-xs leading-5 text-[#57606a]">{selectedDevelopmentTemplate.description ?? "任务开发与里程碑 Loop 将关联此模板指定的 Loop，并在执行时使用项目自己的配置。"}</p>{selectedDevelopmentTemplate.loopGroupConfig ? <div className="grid gap-3 rounded-md border border-[#d0d7de] bg-[#f6f8fa] p-3"><label className="grid gap-1.5 text-sm font-semibold">Loop 组预设<select aria-label="项目 Loop 组预设" multiple value={selectedPresetKeys} onChange={(event) => { const next = Array.from(event.currentTarget.selectedOptions, (option) => option.value); setSelectedPresetKeys(next); if (!next.includes(defaultPresetKey)) setDefaultPresetKey(next[0] ?? ""); }} className="min-h-20 rounded-md border border-[#d0d7de] bg-white px-2 py-2 text-sm font-normal">{selectedDevelopmentTemplate.loopGroupConfig.presets.map((preset) => <option key={preset.key} value={preset.key}>{preset.key}</option>)}</select><span className="text-xs font-normal text-[#57606a]">项目会复制所选预设，后续修改不影响模板。</span></label><label className="grid max-w-md gap-1.5 text-sm font-semibold">默认 Loop 组预设<select aria-label="项目默认 Loop 组预设" value={defaultPresetKey} onChange={(event) => setDefaultPresetKey(event.target.value)} className={inputClass}>{selectedDevelopmentTemplate.loopGroupConfig.presets.filter((preset) => selectedPresetKeys.includes(preset.key)).map((preset) => <option key={preset.key} value={preset.key}>{preset.key}</option>)}</select></label><button type="button" className="h-9 justify-self-start rounded-md border border-[#d0d7de] bg-white px-3 text-sm font-semibold text-[#24292f]" onClick={() => { const key = selectedDevelopmentTemplate.loopGroupConfig?.defaultSelection.defaultPresetKey; if (!key) return; setSelectedPresetKeys([key]); setDefaultPresetKey(key); }}>快速应用默认预设</button></div> : null}<div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-1.5 text-sm font-semibold">生产分支<input aria-label="生产分支" value={productionBranch} onChange={(event) => setProductionBranch(event.target.value)} className={inputClass} /></label><label className="grid gap-1.5 text-sm font-semibold">预发分支<input aria-label="预发分支" value={stagingBranch} onChange={(event) => setStagingBranch(event.target.value)} className={inputClass} />{errors.stagingBranch ? <span role="alert" className="text-xs text-[#cf222e]">{errors.stagingBranch}</span> : null}</label></div><label className="grid gap-1.5 text-sm font-semibold">发版 Agent<select aria-label="发版 Agent" value={releaseAgentProfileId} onChange={(event) => setReleaseAgentProfileId(event.target.value)} className={inputClass}><option value="">请选择</option>{releaseAgentProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.provider}</option>)}</select></label></> : null}
              </div> : null}
              <div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-1.5 text-sm font-semibold">开始日期<input type="date" aria-label="开始日期" value={startAt} onChange={(event) => setStartAt(event.target.value)} className={inputClass} /></label><label className="grid gap-1.5 text-sm font-semibold">目标日期<input type="date" aria-label="目标日期" value={targetAt} onChange={(event) => setTargetAt(event.target.value)} className={inputClass} />{errors.targetAt ? <span role="alert" className="text-xs text-[#cf222e]">{errors.targetAt}</span> : null}</label></div>
            </div>
            <div className="flex justify-end gap-2 border-t border-[#d0d7de] bg-[#fbfcfd] px-5 py-3"><Dialog.Close disabled={pending} className="h-9 rounded-md border border-[#d0d7de] bg-white px-3 text-sm font-semibold">取消</Dialog.Close><button type="submit" disabled={pending || spaces.length === 0} className="h-9 rounded-md bg-[#1f883d] px-4 text-sm font-semibold text-white disabled:opacity-50">{pending ? "创建中" : "创建项目"}</button></div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
