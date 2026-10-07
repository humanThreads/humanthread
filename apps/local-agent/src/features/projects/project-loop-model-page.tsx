import type { ProjectLoopCatalogV2 } from "@humanthread/project-loop-sync";
import { parseForwardCompatibleResponse } from "@humanthread/workbench-client";
import { LockKeyhole, RotateCcw, Save, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { z } from "zod";
import { DEFAULT_REASONING_EFFORT } from "@humanthread/shared";

import {
  modelSelectionSchema,
  REASONING_EFFORT_OPTIONS,
  type LoopModelRouting,
  type ModelCatalog,
  type ModelSelection,
  type ModelSitesDocument,
  type ReasoningEffort,
} from "../../lib/local-model-configuration";
import type { NativeLocalModelCommands } from "../../lib/native-local-model-commands";
import { createNativeLocalModelCommands } from "../../lib/native-local-model-commands";
import { useOptionalDesktopSession } from "../../session/session-provider";
import { projectLoopCatalogV2Schema } from "@humanthread/project-loop-sync";

type SelectionDraft = { siteId: string; modelKey: string; reasoningEffort: ReasoningEffort };
type SelectionMode = "inherit" | "explicit";

const projectLoopCatalogResponseSchema = z.object({
  ok: z.literal(true),
  result: projectLoopCatalogV2Schema,
}).strict();

export async function fetchProjectLoopCatalog(
  input: {
    deploymentOrigin: string;
    projectId: string;
    userId: string;
    deviceId: string;
    credentials: { apiToken: string; deviceToken: string };
  },
  fetchImplementation: typeof fetch = globalThis.fetch,
): Promise<ProjectLoopCatalogV2> {
  const query = new URLSearchParams({
    userId: input.userId,
    deviceId: input.deviceId,
    contractVersion: "2",
  });
  const headers = new Headers({
    accept: "application/json",
    "x-agent-device-token": input.credentials.deviceToken.trim(),
  });
  if (input.credentials.apiToken.trim()) {
    headers.set("authorization", `Bearer ${input.credentials.apiToken.trim()}`);
  }
  const response = await fetchImplementation(
    `${input.deploymentOrigin.replace(/\/+$/u, "")}/api/agent/projects/${encodeURIComponent(input.projectId)}/loop-catalog?${query.toString()}`,
    { headers },
  );
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Loop catalog request failed with status ${response.status}`);
  }
  if (!response.ok) {
    const message = payload && typeof payload === "object" && typeof Reflect.get(payload, "error") === "string"
      ? String(Reflect.get(payload, "error"))
      : `Loop catalog request failed with status ${response.status}`;
    throw new Error(message);
  }
  return parseForwardCompatibleResponse(projectLoopCatalogResponseSchema, payload).result;
}

function selectionKey(loopDefinitionId: string, nodeId: string): string {
  return `${loopDefinitionId}:${nodeId}`;
}

function cloneRouting(value: LoopModelRouting): LoopModelRouting {
  return {
    schemaVersion: 2,
    loops: Object.fromEntries(Object.entries(value.loops).map(([loopId, loop]) => [loopId, {
      ...(loop.default ? { default: { ...loop.default } } : {}),
      nodes: Object.fromEntries(Object.entries(loop.nodes).map(([nodeId, selection]) => [nodeId, { ...selection }])),
    }])),
  };
}

function initialSelectionForms(routing: LoopModelRouting): {
  modes: Record<string, SelectionMode>;
  selections: Record<string, SelectionDraft>;
  defaults: Record<string, SelectionDraft>;
} {
  const modes: Record<string, SelectionMode> = {};
  const selections: Record<string, SelectionDraft> = {};
  const defaults: Record<string, SelectionDraft> = {};
  for (const [loopId, loop] of Object.entries(routing.loops)) {
    if (loop.default) defaults[loopId] = { ...loop.default };
    for (const [nodeId, selection] of Object.entries(loop.nodes)) {
      const key = selectionKey(loopId, nodeId);
      modes[key] = "explicit";
      selections[key] = { ...selection };
    }
  }
  return { modes, selections, defaults };
}

function latestVersion(loop: ProjectLoopCatalogV2["publishedLoops"][number]) {
  return loop.publishedVersions.find((version) => version.loopVersionId === loop.latestPublishedVersionId)
    ?? loop.publishedVersions[loop.publishedVersions.length - 1]!;
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : "本地模型路由保存失败";
}

function formatEffort(value: ReasoningEffort): string {
  return REASONING_EFFORT_OPTIONS.find(([candidate]) => candidate === value)?.[1] ?? "High";
}

function selectionFromDraft(value: SelectionDraft | undefined): ModelSelection | null {
  if (!value) return null;
  const parsed = modelSelectionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function ModelPicker(props: {
  siteLabel: string;
  modelLabel: string;
  sites: ModelSitesDocument;
  catalog: ModelCatalog;
  selection: SelectionDraft | undefined;
  onChange: (selection: SelectionDraft) => void;
  staleLabel?: string;
  effortLabel?: string;
}) {
  const selection = props.selection ?? { siteId: "", modelKey: "", reasoningEffort: DEFAULT_REASONING_EFFORT };
  const models = selection.siteId ? props.catalog.sites[selection.siteId]?.models ?? [] : [];
  const knownModel = models.some((model) => model.modelKey === selection.modelKey);
  const listId = `${props.modelLabel.replaceAll(/[^A-Za-z0-9]/gu, "-")}-options`;
  return (
    <div className="project-loop-model-picker">
      <label>
        <span>{props.siteLabel}</span>
        <select aria-label={props.siteLabel} value={selection.siteId} onChange={(event) => props.onChange({
          siteId: event.target.value,
          modelKey: event.target.value === selection.siteId ? selection.modelKey : "",
          reasoningEffort: selection.reasoningEffort,
        })}>
          <option value="">选择模型站点</option>
          {props.sites.sites.map((site) => <option key={site.siteId} value={site.siteId}>{site.name}</option>)}
        </select>
      </label>
      <label>
        <span>{props.modelLabel}</span>
        <input
          aria-label={props.modelLabel}
          list={listId}
          role="combobox"
          value={selection.modelKey}
          onChange={(event) => props.onChange({ ...selection, modelKey: event.target.value })}
          placeholder={selection.siteId ? "搜索或输入模型 ID" : "先选择模型站点"}
        />
        <datalist id={listId}>
          {models.map((model) => <option key={model.modelKey} value={model.modelKey}>{model.label} · {model.name}</option>)}
        </datalist>
        {selection.modelKey && !knownModel ? <small className="project-loop-model-stale">{props.staleLabel ?? "当前目录不可用，保存后保留此引用"}</small> : null}
      </label>
      <label>
        <span>{props.effortLabel ?? `${props.modelLabel}推理强度`}</span>
        <select aria-label={props.effortLabel ?? `${props.modelLabel}推理强度`} value={selection.reasoningEffort} onChange={(event) => props.onChange({ ...selection, reasoningEffort: event.target.value as ReasoningEffort })}>
          {REASONING_EFFORT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}{value === DEFAULT_REASONING_EFFORT ? "（产品默认）" : ""}</option>)}
        </select>
      </label>
    </div>
  );
}

export function ProjectLoopModelEditor(props: {
  catalog: ProjectLoopCatalogV2;
  sites: ModelSitesDocument;
  modelCatalog: ModelCatalog;
  routing: LoopModelRouting;
  commands: NativeLocalModelCommands;
}) {
  const [draftRouting, setDraftRouting] = useState(() => cloneRouting(props.routing));
  const [forms] = useState(() => initialSelectionForms(props.routing));
  const [nodeModes, setNodeModes] = useState(forms.modes);
  const [nodeSelections, setNodeSelections] = useState(forms.selections);
  const [loopDefaults, setLoopDefaults] = useState(forms.defaults);
  const [selectedLoopId, setSelectedLoopId] = useState(props.catalog.publishedLoops[0]?.loopDefinitionId ?? "");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const selectedLoop = props.catalog.publishedLoops.find((loop) => loop.loopDefinitionId === selectedLoopId)
    ?? props.catalog.publishedLoops[0];
  const version = selectedLoop ? latestVersion(selectedLoop) : null;
  const graph = version?.graph ?? null;
  const agentNodes = graph?.nodes.filter((node) => node.type === "agent_action") ?? [];
  const selectedNode = graph?.nodes.find((node) => (node.nodeId ?? node.key) === selectedNodeId) ?? null;
  const activeLoopRouting = selectedLoop ? draftRouting.loops[selectedLoop.loopDefinitionId] : undefined;
  const orphanCount = useMemo(() => {
    if (!graph || !activeLoopRouting) return 0;
    const nodeIds = new Set(graph.nodes.map((node) => node.nodeId ?? node.key));
    return Object.keys(activeLoopRouting.nodes).filter((nodeId) => !nodeIds.has(nodeId)).length;
  }, [activeLoopRouting, graph]);

  function confirmNavigation(): boolean {
    return !dirty || globalThis.window.confirm("本地模型路由尚未保存，确定要切换吗？");
  }

  function selectNode(nodeId: string) {
    if (nodeId === selectedNodeId || confirmNavigation()) setSelectedNodeId(nodeId);
  }

  function updateNodeSelection(nodeId: string, selection: SelectionDraft) {
    const key = selectionKey(selectedLoop?.loopDefinitionId ?? selectedLoopId, nodeId);
    setNodeSelections((current) => ({ ...current, [key]: selection }));
    setDirty(true);
    setNotice(null);
  }

  function updateLoopDefault(selection: SelectionDraft) {
    if (!selectedLoop) return;
    setLoopDefaults((current) => ({ ...current, [selectedLoop.loopDefinitionId]: selection }));
    setDirty(true);
    setNotice(null);
  }

  function restoreInheritance() {
    if (!selectedLoop || !selectedNode) return;
    const nodeId = selectedNode.nodeId ?? selectedNode.key;
    const key = selectionKey(selectedLoop.loopDefinitionId, nodeId);
    setNodeModes((current) => ({ ...current, [key]: "inherit" }));
    setDirty(true);
    setNotice(null);
  }

  async function saveRouting() {
    if (!selectedLoop) return;
    setPending(true);
    setNotice(null);
    try {
      const next = cloneRouting(draftRouting);
      for (const loop of props.catalog.publishedLoops) {
        const loopId = loop.loopDefinitionId;
        const entry = next.loops[loopId] ?? { nodes: {} };
        const nodes = { ...entry.nodes };
        const currentVersion = latestVersion(loop);
        for (const node of currentVersion.graph.nodes) {
          if (node.type !== "agent_action") continue;
          const nodeId = node.nodeId ?? node.key;
          const key = selectionKey(loopId, nodeId);
          if (nodeModes[key] !== "explicit") {
            delete nodes[nodeId];
            continue;
          }
          const selection = selectionFromDraft(nodeSelections[key]);
          if (!selection) throw new Error(`请为「${node.label}」选择有效的站点和模型`);
          nodes[nodeId] = selection;
        }
        const defaultSelection = selectionFromDraft(loopDefaults[loopId]);
        const nextEntry = {
          ...(defaultSelection ? { default: defaultSelection } : {}),
          nodes,
        };
        if (Object.keys(nodes).length > 0 || defaultSelection) next.loops[loopId] = nextEntry;
        else delete next.loops[loopId];
      }
      const saved = await props.commands.saveRouting(next);
      setDraftRouting(saved);
      setDirty(false);
      setNotice({ tone: "success", text: "本地模型路由已保存，仅保存到此设备" });
    } catch (error) {
      setNotice({ tone: "error", text: readableError(error) });
    } finally {
      setPending(false);
    }
  }

  if (!selectedLoop || !graph) {
    return <div className="project-loop-model-page"><p className="feature-empty-state">当前项目没有可配置的 Loop</p></div>;
  }

  const selectedNodeKey = selectedNode ? selectionKey(selectedLoop.loopDefinitionId, selectedNode.nodeId ?? selectedNode.key) : "";
  const selectedNodeMode = selectedNode?.type === "agent_action" ? (nodeModes[selectedNodeKey] ?? "inherit") : "inherit";
  const defaultSelection = loopDefaults[selectedLoop.loopDefinitionId];

  return (
    <div className="project-loop-model-page">
      <header className="project-loop-model-toolbar">
        <div>
          <span className="project-loop-model-eyebrow"><SlidersHorizontal aria-hidden="true" size={14} />本地模型路由</span>
          <h1>配置 Loop 模型</h1>
          <p>平台 Loop 图只读；模型选择只保存在此设备，不上传模型目录。</p>
        </div>
        <div className="project-loop-model-toolbar-actions">
          <span className="project-loop-model-local-only"><LockKeyhole aria-hidden="true" size={13} />仅保存到此设备</span>
          <button disabled={pending || !dirty} onClick={() => void saveRouting()} type="button"><Save aria-hidden="true" size={15} />保存本地模型路由</button>
        </div>
      </header>
      <div className="project-loop-model-layout">
        <aside className="project-loop-model-graph" aria-label="平台 Loop 图">
          <label className="project-loop-model-loop-select"><span>Loop</span><select value={selectedLoop.loopDefinitionId} onChange={(event) => { if (!confirmNavigation()) return; setSelectedLoopId(event.target.value); setSelectedNodeId(null); }}><option value={selectedLoop.loopDefinitionId}>{selectedLoop.name}</option>{props.catalog.publishedLoops.filter((loop) => loop.loopDefinitionId !== selectedLoop.loopDefinitionId).map((loop) => <option key={loop.loopDefinitionId} value={loop.loopDefinitionId}>{loop.name}</option>)}</select></label>
          <div className="project-loop-model-graph-meta"><span>平台版本 v{version?.versionNumber ?? "-"}</span><span>{graph.nodes.length} 个节点</span></div>
          <div className="project-loop-model-node-list">
            {graph.nodes.map((node) => {
              const nodeId = node.nodeId ?? node.key;
              return <button aria-label={`节点：${node.label}`} aria-current={selectedNodeId === nodeId ? "true" : undefined} key={nodeId} onClick={() => selectNode(nodeId)} type="button"><span data-node-type={node.type}>{node.type === "agent_action" ? "Agent" : node.type === "human_gate" ? "审核" : node.type}</span><strong>节点：{node.label}</strong></button>;
            })}
          </div>
          {orphanCount > 0 ? <p className="project-loop-model-orphans"><span>{orphanCount} 个孤立配置</span>：平台当前图中已不存在的本地节点仍会保留。</p> : null}
        </aside>
        <section className="project-loop-model-inspector" aria-label="Loop 模型配置">
          <div className="project-loop-model-inspector-header"><div><span>Loop 默认</span><strong>{selectedLoop.name}</strong></div><small>未覆盖的 Agent 节点按此设置解析</small></div>
          <ModelPicker siteLabel="Loop 默认模型站点" modelLabel="Loop 默认模型" effortLabel="Loop 默认推理强度" sites={props.sites} catalog={props.modelCatalog} selection={defaultSelection} onChange={updateLoopDefault} />
          {selectedNode?.type === "agent_action" ? <div className="project-loop-model-node-config">
            <div className="project-loop-model-inspector-header"><div><span>节点模型</span><strong>{selectedNode.label}</strong></div><small>节点覆盖优先于 Loop 默认</small></div>
            <label className="project-loop-model-mode"><span>节点模型模式</span><select aria-label="节点模型模式" value={selectedNodeMode} onChange={(event) => { const mode = event.target.value as SelectionMode; setNodeModes((current) => ({ ...current, [selectedNodeKey]: mode })); setDirty(true); setNotice(null); }}><option value="inherit">继承 Loop 默认</option><option value="explicit">使用节点模型</option></select></label>
            {selectedNodeMode === "explicit" ? <>
              <ModelPicker siteLabel="节点模型站点" modelLabel="节点模型" effortLabel="节点推理强度" sites={props.sites} catalog={props.modelCatalog} selection={nodeSelections[selectedNodeKey]} onChange={(selection) => updateNodeSelection(selectedNode.nodeId ?? selectedNode.key, selection)} />
              <button className="project-loop-model-reset" disabled={pending} onClick={restoreInheritance} type="button"><RotateCcw aria-hidden="true" size={14} />恢复继承</button>
            </> : <p className="project-loop-model-inherited">{formatEffort(activeLoopRouting?.default?.reasoningEffort ?? props.sites.accountDefault?.reasoningEffort ?? selectedNode.reasoningEffort ?? DEFAULT_REASONING_EFFORT)} · 继承 {activeLoopRouting?.default ? "Loop 默认" : props.sites.accountDefault ? "账号默认" : selectedNode.reasoningEffort ? "平台节点" : "产品默认"}</p>}
          </div> : <div className="project-loop-model-readonly"><LockKeyhole aria-hidden="true" size={15} /><strong>节点模型不可配置</strong><p>只有 agent_action 节点会在本地执行并允许模型覆盖。</p></div>}
        </section>
      </div>
      {notice ? <p className="runtime-settings-notice" data-tone={notice.tone} role={notice.tone === "error" ? "alert" : "status"}>{notice.text}</p> : null}
    </div>
  );
}

export function ProjectLoopModelPage() {
  const { projectId = "" } = useParams();
  const session = useOptionalDesktopSession();
  const catalogQuery = useQuery({
    enabled: Boolean(projectId && session?.context && session.user && session.localDeviceId && session.runtimeCredentials),
    queryKey: ["desktop", "project-loop-catalog", session?.context?.deploymentKey ?? "disabled", session?.context?.spaceKey ?? "disabled", projectId],
    queryFn: async () => {
      if (!session?.context || !session.user || !session.localDeviceId || !session.runtimeCredentials) throw new Error("桌面会话不可用");
      return fetchProjectLoopCatalog({
        deploymentOrigin: session.context.deploymentKey,
        projectId,
        userId: session.user.id,
        deviceId: session.localDeviceId,
        credentials: session.runtimeCredentials,
      });
    },
  });
  const localCommands = useMemo(() => {
    if (!session?.context || !session.user) return null;
    const bridge = window.humanthreadNative;
    if (!bridge) return null;
    return createNativeLocalModelCommands({ deploymentOrigin: session.context.deploymentKey, userId: session.user.id }, (command, args) => bridge.invoke(command, args));
  }, [session?.context, session?.user]);
  const localQuery = useQuery({
    enabled: Boolean(localCommands),
    queryKey: ["desktop", "local-model-routing", session?.context?.deploymentKey ?? "disabled", session?.user?.id ?? "disabled"],
    queryFn: async () => {
      if (!localCommands) throw new Error("本地模型命令不可用");
      const [sites, modelCatalog, routing] = await Promise.all([localCommands.listSites(), localCommands.getCatalog(), localCommands.getRouting()]);
      return { sites, modelCatalog, routing };
    },
  });

  if (catalogQuery.isPending || localQuery.isPending) return <div aria-label="正在加载 Loop 模型配置" className="feature-loading-state" />;
  if (catalogQuery.isError) return <p className="feature-error-state" role="alert">{catalogQuery.error.message}</p>;
  if (localQuery.isError) return <p className="feature-error-state" role="alert">{localQuery.error.message}</p>;
  if (!localCommands || !catalogQuery.data || !localQuery.data) return <p className="feature-error-state" role="alert">桌面会话不可用</p>;

  return <ProjectLoopModelEditor catalog={catalogQuery.data} sites={localQuery.data.sites} modelCatalog={localQuery.data.modelCatalog} routing={localQuery.data.routing} commands={localCommands} />;
}
