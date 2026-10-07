"use client";

import { useMemo, useState } from "react";
import { StatusPill, WorkbenchButton } from "../workbench-ui";
import { LOOP_MARKET_INDUSTRIES } from "./development-template-library";

const SENSITIVE_KEY = /secret|token|password|credential|accessKey|localPath|absolutePath/i;

export interface DevelopmentTemplateEditorTemplate {
  id: string;
  name: string;
  description: string | null;
  kind: string;
  version: number;
  status: "draft" | "published" | "deprecated";
  origin: "platform" | "space";
  revision: number;
  projectConfigSchema: unknown;
  taskFieldSchema: unknown;
  developmentLoopVersionId: string | null;
  releaseLoopVersionId: string | null;
  triggerPolicy: unknown;
  executionPolicy: unknown;
  loopGroupConfig?: LoopGroupConfig | null | undefined;
  sourceTemplateId?: string | null;
  industryTags?: readonly string[] | undefined;
  isPublic?: boolean | undefined;
}

interface LoopGroupPreset {
  key: string;
  taskLoopIds: readonly string[];
  defaultTaskLoopId: string;
  projectLoopIds: readonly string[];
  defaultProjectLoopId: string;
  projectLoopNodeTaskLoopIds?: Readonly<Record<string, Readonly<Record<string, string>>>> | undefined;
}

interface LoopGroupConfig {
  presets: readonly LoopGroupPreset[];
  defaultSelection: { selectedPresetKeys: readonly string[]; defaultPresetKey: string };
}

export interface DevelopmentTemplateLoopVersion {
  id: string;
  versionNumber: number;
  status: "published";
  definition: { id: string; name: string; scope: "task" | "project"; origin: "platform" | "space"; spaceId: string | null };
  graph?: { nodes: ReadonlyArray<{ key: string; label: string; type: string }> };
  flow?: ReadonlyArray<{ key: string; label: string; type: string; detail: string | null; outcomes: string[] }>;
}

export interface DevelopmentTemplateEditorApi {
  saveDraft(input: Record<string, unknown>): Promise<{ revision?: number }>;
  copy(): Promise<void>;
}

type FieldErrors = Partial<Record<"developmentLoopVersionId" | "releaseLoopVersionId", string>>;

export function DevelopmentTemplateEditor({ template, loops, spaceId, canManage = true, api: suppliedApi }: { template: DevelopmentTemplateEditorTemplate; loops: readonly DevelopmentTemplateLoopVersion[]; spaceId?: string; canManage?: boolean; api?: DevelopmentTemplateEditorApi }) {
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description ?? "");
  const [industryTags, setIndustryTags] = useState<string[]>([...(template.industryTags ?? [])]);
  const presetConfig = template.loopGroupConfig;
  const publishedTaskLoops = loops.filter((loop) => loop.status === "published" && loop.definition.scope === "task");
  const publishedProjectLoops = loops.filter((loop) => loop.status === "published" && loop.definition.scope === "project");
  const presetKeys = presetConfig?.presets.map((preset) => preset.key) ?? [];
  const initialPresetSelection = presetConfig?.defaultSelection.selectedPresetKeys.filter((key) => presetKeys.includes(key)) ?? [];
  const initialPresetLoops = aggregatePresetLoops(presetConfig, initialPresetSelection);
  const initialProjectIds = initialPresetLoops.projectLoopIds.length > 0 ? initialPresetLoops.projectLoopIds : template.releaseLoopVersionId && publishedProjectLoops.some((loop) => loop.id === template.releaseLoopVersionId) ? [template.releaseLoopVersionId] : [];
  const initialTaskDefault = template.developmentLoopVersionId && publishedProjectLoops.some((loop) => loop.id === template.developmentLoopVersionId) ? template.developmentLoopVersionId : initialPresetLoops.defaultTaskLoopId;
  const [taskLoopVersionIds, setTaskLoopVersionIds] = useState<string[]>(initialPresetLoops.taskLoopIds.length > 0 ? initialPresetLoops.taskLoopIds : template.developmentLoopVersionId && publishedTaskLoops.some((loop) => loop.id === template.developmentLoopVersionId) ? [template.developmentLoopVersionId] : []);
  const [projectLoopVersionIds, setProjectLoopVersionIds] = useState<string[]>(initialProjectIds);
  const [defaultTaskLoopVersionId, setDefaultTaskLoopVersionId] = useState(initialTaskDefault ?? initialProjectIds[0] ?? "");
  const [defaultProjectLoopVersionId, setDefaultProjectLoopVersionId] = useState(template.releaseLoopVersionId ?? initialPresetLoops.defaultProjectLoopId ?? initialPresetLoops.projectLoopIds[0] ?? "");
  const [selectedPresetKeys, setSelectedPresetKeys] = useState<string[]>(initialPresetSelection);
  const [defaultPresetKey, setDefaultPresetKey] = useState(template.loopGroupConfig?.defaultSelection.defaultPresetKey ?? initialPresetSelection[0] ?? "");
  const initialNodeMappings = initialPresetSelection.reduce<Record<string, Record<string, string>>>((result, key) => {
    const preset = presetConfig?.presets.find((candidate) => candidate.key === key);
    for (const [projectId, nodes] of Object.entries(preset?.projectLoopNodeTaskLoopIds ?? {})) result[projectId] = { ...(result[projectId] ?? {}), ...nodes };
    return result;
  }, {});
  const [projectLoopNodeTaskLoopIds, setProjectLoopNodeTaskLoopIds] = useState<Record<string, Record<string, string>>>(initialNodeMappings);
  const [revision, setRevision] = useState(template.revision);
  const [pending, setPending] = useState<"save" | "copy" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const readOnly = !canManage || template.origin === "platform" || template.status === "deprecated";
  const api = useMemo(() => suppliedApi ?? browserApi(template.id, spaceId), [spaceId, suppliedApi, template.id]);
  const selectedLoops = [...new Set([defaultTaskLoopVersionId, defaultProjectLoopVersionId])].flatMap((id) => loops.filter((loop) => loop.id === id));

  function draftInput(expectedRevision: number): Record<string, unknown> {
    const selected = selectedPresetKeys.length > 0 ? selectedPresetKeys : presetKeys.slice(0, 1);
    const selectedTaskLoops = taskLoopVersionIds;
    const selectedProjectLoops = projectLoopVersionIds.length > 0 ? projectLoopVersionIds : defaultProjectLoopVersionId ? [defaultProjectLoopVersionId] : [];
    const loopGroup = presetConfig && selected.length > 0
      ? { presets: presetConfig.presets.map((preset) => preset.key === (selected.includes(defaultPresetKey) ? defaultPresetKey : selected[0]) ? { ...preset, taskLoopIds: selectedTaskLoops, defaultTaskLoopId: defaultTaskLoopVersionId || selectedProjectLoops[0] || "", projectLoopIds: selectedProjectLoops, defaultProjectLoopId: defaultProjectLoopVersionId || selectedProjectLoops[0] || "", projectLoopNodeTaskLoopIds } : preset), defaultSelection: { selectedPresetKeys: selected, defaultPresetKey: selected.includes(defaultPresetKey) ? defaultPresetKey : selected[0] } }
      : selectedProjectLoops.length > 0
        ? { presets: [{ key: "自定义", taskLoopIds: selectedTaskLoops, defaultTaskLoopId: defaultTaskLoopVersionId || selectedProjectLoops[0], projectLoopIds: selectedProjectLoops, defaultProjectLoopId: defaultProjectLoopVersionId || selectedProjectLoops[0], projectLoopNodeTaskLoopIds }], defaultSelection: { selectedPresetKeys: ["自定义"], defaultPresetKey: "自定义" } }
        : null;
    return {
      commandId: commandId(), expectedRevision, name: name.trim(), description: description.trim() || null,
      projectConfigSchema: safeRecord(template.projectConfigSchema), taskFieldSchema: safeRecord(template.taskFieldSchema),
      developmentLoopVersionId: defaultTaskLoopVersionId || null, releaseLoopVersionId: defaultProjectLoopVersionId || null,
      triggerPolicy: safeRecord(template.triggerPolicy), executionPolicy: safeRecord(template.executionPolicy),
      industryTags,
      ...(loopGroup ? { loopGroupConfig: loopGroup } : {}),
    };
  }

  async function save() {
    if (readOnly || pending) return;
    setPending("save"); setMessage(null); setFieldErrors({});
    try {
      const result = await api.saveDraft(draftInput(revision));
      if (typeof result.revision === "number") setRevision(result.revision);
      setMessage("模板已保存");
    } catch (error) { applyError(error, setFieldErrors, setMessage); } finally { setPending(null); }
  }

  async function copy() {
    if (pending) return;
    setPending("copy"); setMessage(null);
    try { await api.copy(); } catch (error) { applyError(error, setFieldErrors, setMessage); } finally { setPending(null); }
  }

  return <div className="mx-auto grid w-full max-w-5xl gap-5 p-4 sm:p-5">
    {message ? <p role="alert" className="text-sm text-[#cf222e]">{message}</p> : null}
    <section className="border-y border-[#d0d7de] bg-white"><header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#d0d7de] px-4 py-3"><div><h2 className="text-sm font-semibold text-[#24292f]">Loop 模板</h2><p className="mt-1 text-xs text-[#57606a]">修订 {revision}</p></div><div className="flex gap-2"><StatusPill>{template.origin === "platform" ? "平台内置" : "Space 自定义"}</StatusPill>{template.isPublic ? <StatusPill tone="success">已公开到市场</StatusPill> : null}</div></header><div className="grid gap-4 p-4 sm:grid-cols-2"><label className="grid gap-1.5 text-sm font-semibold text-[#24292f]">名称<input aria-label="名称" value={name} disabled={readOnly} onChange={(event) => setName(event.currentTarget.value)} className="rounded-md border border-[#d0d7de] px-3 py-2 text-sm font-normal" /></label><label className="grid gap-1.5 text-sm font-semibold text-[#24292f]">类型<input aria-label="类型" value={template.kind} disabled className="rounded-md border border-[#d0d7de] bg-[#f6f8fa] px-3 py-2 text-sm font-normal" /></label><label className="grid gap-1.5 text-sm font-semibold text-[#24292f] sm:col-span-2">说明<textarea aria-label="说明" value={description} disabled={readOnly} rows={3} onChange={(event) => setDescription(event.currentTarget.value)} className="rounded-md border border-[#d0d7de] px-3 py-2 text-sm font-normal" /></label>{template.origin === "space" ? <label className="grid gap-1.5 text-sm font-semibold text-[#24292f] sm:col-span-2">行业标签（可多选）<select aria-label="行业标签" multiple value={industryTags} disabled={readOnly} onChange={(event) => setIndustryTags(Array.from(event.currentTarget.selectedOptions, (option) => option.value))} className="min-h-28 rounded-md border border-[#d0d7de] bg-white px-3 py-2 text-sm font-normal">{LOOP_MARKET_INDUSTRIES.map((industry) => <option key={industry} value={industry}>{industry}</option>)}</select><span className="text-xs font-normal text-[#57606a]">保存后可在“自定义”中公开到 Loop 市场。</span></label> : null}<dl className="grid gap-3 text-xs text-[#57606a] sm:col-span-2 sm:grid-cols-3"><Fact label="来源" value={template.sourceTemplateId ? `复制自 ${template.sourceTemplateId}` : template.origin === "platform" ? "平台内置" : "Space 创建"} /><Fact label="项目参数" value={schemaSummary(template.projectConfigSchema)} /><Fact label="任务参数" value={schemaSummary(template.taskFieldSchema)} /></dl><PolicySummary title="触发策略" value={template.triggerPolicy} /><PolicySummary title="执行策略" value={template.executionPolicy} /></div></section>
    <section className="border-y border-[#d0d7de] bg-white"><header className="border-b border-[#d0d7de] px-4 py-3"><h2 className="text-sm font-semibold text-[#24292f]">关联 Loop</h2><p className="mt-1 text-xs text-[#57606a]">项目 Loop 负责项目级流程，并在其中选择默认任务 Loop 与默认里程碑 Loop；任务 Loop 列表仅用于提供可复用的子流程。</p></header><div className="grid gap-4 p-4">{presetConfig ? <div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-1.5 text-sm font-semibold text-[#24292f]">Loop 组预设<select aria-label="Loop 组预设" multiple value={selectedPresetKeys} disabled={readOnly} onChange={(event) => { const next = Array.from(event.currentTarget.selectedOptions, (option) => option.value); setSelectedPresetKeys(next); if (!next.includes(defaultPresetKey)) setDefaultPresetKey(next[0] ?? ""); }} className="min-h-24 rounded-md border border-[#d0d7de] bg-white px-3 py-2 text-sm font-normal">{presetConfig.presets.map((preset) => <option key={preset.key} value={preset.key}>{preset.key}</option>)}</select></label><label className="grid gap-1.5 text-sm font-semibold text-[#24292f]">默认 Loop 组预设<select aria-label="默认 Loop 组预设" value={defaultPresetKey} disabled={readOnly || selectedPresetKeys.length === 0} onChange={(event) => setDefaultPresetKey(event.currentTarget.value)} className="rounded-md border border-[#d0d7de] bg-white px-3 py-2 text-sm font-normal">{presetConfig.presets.filter((preset) => selectedPresetKeys.includes(preset.key)).map((preset) => <option key={preset.key} value={preset.key}>{preset.key}</option>)}</select></label></div> : null}<LoopChecklist title="项目 Loop 列表" loops={publishedProjectLoops} selected={projectLoopVersionIds} defaultId={defaultTaskLoopVersionId} defaultLabel="默认任务 Loop" secondaryDefaultId={defaultProjectLoopVersionId} secondaryDefaultLabel="默认里程碑 Loop" iconLabel="项目 Loop 默认角色图标" disabled={readOnly} onSelectionChange={(next) => { setProjectLoopVersionIds(next); if (defaultTaskLoopVersionId && !next.includes(defaultTaskLoopVersionId)) setDefaultTaskLoopVersionId(next[0] ?? ""); if (defaultProjectLoopVersionId && !next.includes(defaultProjectLoopVersionId)) setDefaultProjectLoopVersionId(next[0] ?? ""); setProjectLoopNodeTaskLoopIds((current) => Object.fromEntries(Object.entries(current).filter(([id]) => next.includes(id)))); }} onDefaultChange={setDefaultTaskLoopVersionId} onSecondaryDefaultChange={setDefaultProjectLoopVersionId} error={fieldErrors.developmentLoopVersionId ?? fieldErrors.releaseLoopVersionId} /><ProjectNodeTaskLoopMapping loops={publishedProjectLoops} selected={projectLoopVersionIds} taskLoops={publishedTaskLoops.filter((loop) => taskLoopVersionIds.includes(loop.id))} mappings={projectLoopNodeTaskLoopIds} disabled={readOnly} onChange={setProjectLoopNodeTaskLoopIds} /><LoopChecklist title="任务 Loop 列表" loops={publishedTaskLoops} selected={taskLoopVersionIds} disabled={readOnly} onSelectionChange={(next) => { setTaskLoopVersionIds(next); setProjectLoopNodeTaskLoopIds((current) => Object.fromEntries(Object.entries(current).map(([projectId, nodes]) => [projectId, Object.fromEntries(Object.entries(nodes).filter(([, taskId]) => next.includes(taskId)))]))); }} /></div>{selectedLoops.length > 0 ? <div className="border-t border-[#d0d7de] p-4"><h3 className="text-sm font-semibold text-[#24292f]">已关联流程预览</h3><div className="mt-3 grid gap-3 lg:grid-cols-2">{selectedLoops.map((loop) => <article key={loop.id} className="border border-[#d0d7de] p-3"><h4 className="text-xs font-semibold text-[#24292f]">{loop.definition.name}</h4><ol className="mt-3 grid gap-2">{(loop.flow ?? loop.graph?.nodes.map((node) => ({ ...node, detail: null, outcomes: [] })) ?? []).map((node, index) => <li key={node.key} className="text-sm text-[#24292f]"><span className="mr-2 text-xs text-[#6e7781]">{index + 1}</span>{node.label}</li>)}</ol></article>)}</div></div> : null}</section>
    <div className="flex flex-wrap justify-end gap-2">{readOnly ? <WorkbenchButton type="button" variant="primary" disabled={pending === "copy"} onClick={copy}>{pending === "copy" ? "复制中" : "复制为自定义模板"}</WorkbenchButton> : <WorkbenchButton type="button" variant="primary" disabled={Boolean(pending)} onClick={save}>{pending === "save" ? "保存中" : "保存模板"}</WorkbenchButton>}</div>
  </div>;
}

function LoopChecklist({ title, loops, selected, defaultId, defaultLabel, secondaryDefaultId, secondaryDefaultLabel, iconLabel, disabled, onSelectionChange, onDefaultChange, onSecondaryDefaultChange, error }: { title: string; loops: readonly DevelopmentTemplateLoopVersion[]; selected: readonly string[]; defaultId?: string; defaultLabel?: string; secondaryDefaultId?: string; secondaryDefaultLabel?: string; iconLabel?: string; disabled: boolean; onSelectionChange(value: string[]): void; onDefaultChange?: (value: string) => void; onSecondaryDefaultChange?: (value: string) => void; error?: string | undefined }) {
  return <fieldset aria-label={title} className="grid gap-2 rounded-md border border-[#d0d7de] p-3"><legend className="px-1 text-sm font-semibold text-[#24292f]">{title}</legend><div className="grid gap-2">{loops.map((loop) => { const checked = selected.includes(loop.id); return <div key={loop.id} className="flex items-center justify-between gap-3 rounded border border-[#d0d7de] px-3 py-2"><label className="flex min-w-0 items-center gap-2 text-sm font-normal text-[#24292f]"><input type="checkbox" aria-label={loop.definition.name} checked={checked} disabled={disabled} onChange={(event) => { const next = event.currentTarget.checked ? [...selected, loop.id] : selected.filter((id) => id !== loop.id); onSelectionChange(next); }} /><span className="truncate">{loop.definition.name} · v{loop.versionNumber}</span></label>{defaultLabel && onDefaultChange ? <label className="flex shrink-0 items-center gap-1 text-xs text-[#57606a]" title="默认任务 Loop 图标"><input type="radio" name={`${title}-default-task`} aria-label={`${defaultLabel}：${loop.definition.name}`} value={loop.id} checked={defaultId === loop.id} disabled={disabled || !checked} onChange={() => onDefaultChange(loop.id)} /><span aria-hidden="true">◆</span><span>{defaultLabel}</span></label> : null}{secondaryDefaultLabel && onSecondaryDefaultChange ? <label className="flex shrink-0 items-center gap-1 text-xs text-[#57606a]" title="默认里程碑 Loop 图标"><input type="radio" name={`${title}-default-project`} aria-label={`${secondaryDefaultLabel}：${loop.definition.name}`} value={loop.id} checked={secondaryDefaultId === loop.id} disabled={disabled || !checked} onChange={() => onSecondaryDefaultChange(loop.id)} /><span aria-hidden="true">✦</span><span>{secondaryDefaultLabel}</span></label> : null}</div>; })}</div>{error ? <span role="alert" className="text-xs text-[#cf222e]">{error}</span> : null}{iconLabel ? <><span className="sr-only" aria-label="默认任务 Loop 图标">菱形标记</span><span className="sr-only" aria-label="默认里程碑 Loop 图标">星形标记</span></> : null}</fieldset>;
}
function ProjectNodeTaskLoopMapping({ loops, selected, taskLoops, mappings, disabled, onChange }: { loops: readonly DevelopmentTemplateLoopVersion[]; selected: readonly string[]; taskLoops: readonly DevelopmentTemplateLoopVersion[]; mappings: Record<string, Record<string, string>>; disabled: boolean; onChange(value: Record<string, Record<string, string>>): void }) {
  const selectedLoops = loops.filter((loop) => selected.includes(loop.id));
  if (selectedLoops.length === 0) return <p className="rounded-md border border-dashed border-[#d0d7de] p-3 text-xs text-[#57606a]">先关联项目 Loop，才能配置节点级任务 Loop。</p>;
  return <fieldset aria-label="项目 Loop 节点任务 Loop 映射" className="grid gap-3 rounded-md border border-[#d0d7de] bg-[#f6f8fa] p-3"><legend className="px-1 text-sm font-semibold text-[#24292f]">项目 Loop 节点任务 Loop 映射</legend>{selectedLoops.map((loop) => <div key={loop.id} className="grid gap-2 border border-[#d0d7de] bg-white p-3"><div className="text-sm font-semibold text-[#24292f]">{loop.definition.name}</div>{(loop.flow ?? loop.graph?.nodes.map((node) => ({ ...node, detail: null, outcomes: [] })) ?? []).filter((node) => node.type === "subloop_call").map((node) => <label key={node.key} className="grid gap-1 text-xs text-[#57606a]"><span>{node.label}<code className="ml-1 text-[10px] text-[#8c959f]">{node.key}</code></span><select aria-label={`${loop.definition.name}：${node.label}`} value={mappings[loop.id]?.[node.key] ?? ""} disabled={disabled || taskLoops.length === 0} onChange={(event) => onChange({ ...mappings, [loop.id]: { ...(mappings[loop.id] ?? {}), [node.key]: event.currentTarget.value } })} className="rounded border border-[#d0d7de] bg-white px-2 py-1.5 text-sm text-[#24292f]"><option value="">不指定</option>{taskLoops.map((taskLoop) => <option key={taskLoop.id} value={taskLoop.id}>{taskLoop.definition.name} · v{taskLoop.versionNumber}</option>)}</select></label>)}</div>)}</fieldset>;
}
function aggregatePresetLoops(config: LoopGroupConfig | null | undefined, selectedKeys: readonly string[]): { taskLoopIds: string[]; projectLoopIds: string[]; defaultTaskLoopId: string; defaultProjectLoopId: string } { const selected = new Set(selectedKeys); const presets = (config?.presets ?? []).filter((preset) => selected.has(preset.key)); return { taskLoopIds: [...new Set(presets.flatMap((preset) => preset.taskLoopIds))], projectLoopIds: [...new Set(presets.flatMap((preset) => preset.projectLoopIds))], defaultTaskLoopId: presets[0]?.defaultTaskLoopId ?? "", defaultProjectLoopId: presets[0]?.defaultProjectLoopId ?? "" }; }
function Fact({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd className="mt-1 font-semibold text-[#24292f]">{value}</dd></div>; }
function PolicySummary({ title, value }: { title: string; value: unknown }) { const rendered = safeRecord(value); return <div className="text-xs text-[#57606a]"><strong className="text-[#24292f]">{title}</strong><p className="mt-1 break-words">{Object.keys(rendered).length === 0 ? "未配置" : JSON.stringify(rendered)}</p></div>; }
function schemaSummary(value: unknown): string { const record = recordValue(value); const properties = record && recordValue(record.properties); return properties ? `${Object.keys(properties).filter((key) => !SENSITIVE_KEY.test(key)).length} 个字段` : "未配置"; }
function recordValue(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function safeRecord(value: unknown): Record<string, unknown> { return recordValue(safeValue(value)) ?? {}; }
function safeValue(value: unknown): unknown { if (Array.isArray(value)) return value.map(safeValue); const record = recordValue(value); if (!record) return value; return Object.fromEntries(Object.entries(record).filter(([key]) => !SENSITIVE_KEY.test(key)).map(([key, child]) => [key, safeValue(child)])); }
function commandId(): string { return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `development-template-${Date.now().toString(36)}`; }
function applyError(error: unknown, setFieldErrors: (value: FieldErrors) => void, setMessage: (value: string) => void) { const record = recordValue(error); const issues = Array.isArray(record?.issues) ? record.issues : []; const next: FieldErrors = {}; for (const issue of issues) { const item = recordValue(issue); const rawPath = item?.path; const path = Array.isArray(rawPath) && typeof rawPath[0] === "string" ? rawPath[0] : null; const key = path === "developmentLoopVersionId" || path === "releaseLoopVersionId" ? path : null; if (key && typeof item?.message === "string") next[key] = item.message; } setFieldErrors(next); setMessage(error instanceof Error ? error.message : typeof record?.error === "string" ? record.error : "开发模板操作失败"); }
function browserApi(templateId: string, spaceId?: string): DevelopmentTemplateEditorApi { return { saveDraft: async (input) => request(`/api/development-templates/${encodeURIComponent(templateId)}`, "PATCH", input), copy: async () => { if (!spaceId) return; const result = await request(`/api/development-templates/${encodeURIComponent(templateId)}/copy`, "POST", { commandId: commandId(), spaceId, name: "开发模板（副本）" }); const copiedTemplateId = result.templateId ?? result.id; if (copiedTemplateId) window.location.assign(`/templates/development/${encodeURIComponent(copiedTemplateId)}`); } }; }
async function request(path: string, method: string, body: unknown): Promise<{ revision?: number; id?: string; templateId?: string }> { const response = await fetch(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const result = await response.json() as { ok?: boolean; result?: { revision?: number; id?: string; templateId?: string }; error?: string; issues?: unknown[] }; if (!response.ok || !result.ok) throw result; return result.result ?? {}; }
