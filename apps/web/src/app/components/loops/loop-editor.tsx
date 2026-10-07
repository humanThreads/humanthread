"use client";

import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  type Connection,
  type Edge,
  type Node,
} from "@xyflow/react";
import {
  DEFAULT_REASONING_EFFORT,
  validateLoopGraph,
  stableNodeId,
  type LoopAuthoringGraph,
  type LoopNodeDefinition,
} from "@humanthread/orchestration-core";
import { Plus, Redo2, Save, Undo2, Upload, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { WorkbenchButton } from "../workbench-ui";
import { LoopInspector, type LoopEditorSelection } from "./loop-inspector";
import { LoopNode, type LoopFlowNodeData } from "./loop-node";
import { LoopValidationPanel } from "./loop-validation-panel";
import { layoutLoopNodes } from "./loop-graph-layout";

const NODE_CATALOG = [
  { type: "start", label: "开始" },
  { type: "agent_action", label: "Agent 操作" },
  { type: "platform_action", label: "平台操作" },
  { type: "condition", label: "条件" },
  { type: "policy_gate", label: "策略门禁" },
  { type: "human_gate", label: "人工确认" },
  { type: "wait_callback", label: "等待回调" },
  { type: "subloop_call", label: "任务 SubLoop" },
  { type: "end", label: "结束" },
] as const;

type NodeCatalogType = (typeof NODE_CATALOG)[number]["type"];

export interface LoopEditorInitial {
  definition: {
    id: string;
    name: string;
    description: string | null;
    scope?: "task" | "project";
    origin?: "space" | "platform";
    readOnly?: boolean;
    activeVersionId?: string | null;
  };
  graph: LoopAuthoringGraph;
  draftRevision: number;
  versions: unknown[];
  subloopOptions?: Array<{
    definitionId: string;
    name: string;
    versions: Array<{ id: string; versionNumber: number }>;
  }>;
  platformCaps: { maxStages: number; maxRepeatCount: number; maxTransitions: number };
}

export interface LoopEditorApi {
  saveDraft(input: { graph: LoopAuthoringGraph; draftRevision: number }): Promise<{ draftRevision: number }>;
  publish(input: { graph: LoopAuthoringGraph; draftRevision: number }): Promise<{ versionNumber: number; checksum: string }>;
  activateVersion?(input: { activeVersionId: string; draftRevision: number }): Promise<{ draftRevision: number }>;
}

export function LoopEditor({ initial, api: suppliedApi }: { initial: LoopEditorInitial; api?: LoopEditorApi }) {
  const api = useMemo(
    () => suppliedApi ?? createBrowserLoopEditorApi(initial),
    [initial, suppliedApi],
  );
  const [graph, setGraph] = useState(initial.graph);
  const [history, setHistory] = useState<LoopAuthoringGraph[]>([]);
  const [future, setFuture] = useState<LoopAuthoringGraph[]>([]);
  const [selection, setSelection] = useState<LoopEditorSelection>(null);
  const [dirty, setDirty] = useState(false);
  const [draftRevision, setDraftRevision] = useState(initial.draftRevision);
  const [activeVersionId, setActiveVersionId] = useState(initial.definition.activeVersionId ?? null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [activatingVersionId, setActivatingVersionId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "status" | "error"; text: string } | null>(null);
  const readOnly = initial.definition.readOnly === true || initial.definition.origin === "platform";
  const scopeLabel = initial.definition.scope === "project" ? "项目级" : "任务级";
  const compactLayout = useSyncExternalStore(
    subscribeCompactLayout,
    readCompactLayout,
    () => false,
  );
  const validationErrors = useMemo(
    () => collectValidationErrors(graph, initial.platformCaps, initial.definition.scope === "project", initial.subloopOptions ?? []),
    [graph, initial.definition.scope, initial.platformCaps, initial.subloopOptions],
  );
  const flowNodes = useMemo(
    () => toFlowNodes(graph, selection, compactLayout),
    [compactLayout, graph, selection],
  );
  const flowEdges = useMemo(() => toFlowEdges(graph, selection), [graph, selection]);

  const changeGraph = useCallback((next: LoopAuthoringGraph | ((current: LoopAuthoringGraph) => LoopAuthoringGraph)) => {
    if (readOnly) return;
    setGraph((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      if (resolved === current) return current;
      setHistory((items) => [...items.slice(-49), current]);
      setFuture([]);
      setDirty(true);
      setNotice(null);
      return resolved;
    });
  }, [readOnly]);

  const undo = useCallback(() => {
    if (readOnly) return;
    setHistory((items) => {
      const previous = items.at(-1);
      if (!previous) return items;
      setGraph((current) => {
        setFuture((nextItems) => [current, ...nextItems].slice(0, 50));
        return previous;
      });
      setDirty(true);
      setSelection(null);
      return items.slice(0, -1);
    });
  }, [readOnly]);

  const redo = useCallback(() => {
    if (readOnly) return;
    setFuture((items) => {
      const next = items[0];
      if (!next) return items;
      setGraph((current) => {
        setHistory((previousItems) => [...previousItems.slice(-49), current]);
        return next;
      });
      setDirty(true);
      setSelection(null);
      return items.slice(1);
    });
  }, [readOnly]);

  const deleteSelection = useCallback(() => {
    if (readOnly) return;
    if (!selection) return;
    changeGraph((current) => {
      if (selection.kind === "edge") {
        return { ...current, edges: current.edges.filter((edge) => edge.id !== selection.id) };
      }
      const node = current.nodes.find((candidate) => candidate.key === selection.id);
      if (!node || node.type === "start" || node.type === "end") return current;
      return {
        ...current,
        nodes: current.nodes.filter((candidate) => candidate.key !== selection.id),
        edges: current.edges.filter((edge) => edge.source !== selection.id && edge.target !== selection.id),
        ...(current.schemaVersion === 2 ? {
          routingMetadata: Object.fromEntries(
            Object.entries(current.routingMetadata).filter(([nodeId]) => nodeId !== stableNodeId(node)),
          ),
        } : {}),
      };
    });
    setSelection(null);
  }, [changeGraph, readOnly, selection]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const editingText = target instanceof Element
        ? target.matches("input, textarea, [contenteditable='true']")
        : false;
      if ((event.key === "Delete" || event.key === "Backspace") && !editingText) {
        event.preventDefault();
        deleteSelection();
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && !editingText) {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y" && !editingText) {
        event.preventDefault();
        redo();
      }
    };
    const handleDocumentClick = (event: MouseEvent) => {
      if (!dirty || event.defaultPrevented || event.button !== 0) return;
      const target = event.target;
      const anchor = target instanceof Element ? target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank") return;
      const destination = new URL(anchor.href, window.location.href);
      if (destination.origin !== window.location.origin) return;
      if (!window.confirm("存在未保存更改，确定离开？")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("click", handleDocumentClick, true);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("click", handleDocumentClick, true);
    };
  }, [deleteSelection, dirty, redo, undo]);

  async function saveDraft() {
    setSaving(true);
    setNotice(null);
    try {
      const result = await api.saveDraft({ graph, draftRevision });
      setDraftRevision(result.draftRevision);
      setDirty(false);
      setNotice({ tone: "status", text: `草稿已保存，修订号 ${result.draftRevision}` });
    } catch (error) {
      const conflict = readConflict(error);
      setNotice({
        tone: "error",
        text: conflict === null
          ? "草稿保存失败，请重试"
          : `草稿已在其他位置更新，当前修订号 ${conflict}`,
      });
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    setPublishing(true);
    setNotice(null);
    try {
      const result = await api.publish({ graph, draftRevision });
      setPublishOpen(false);
      setNotice({ tone: "status", text: `版本 ${result.versionNumber} 已发布 · ${result.checksum}` });
    } catch {
      setNotice({ tone: "error", text: "版本发布失败，请重试" });
    } finally {
      setPublishing(false);
    }
  }

  async function activateVersion(activeVersionId: string) {
    if (readOnly || activeVersionId === (initial.definition.activeVersionId ?? null)) return;
    if (!api.activateVersion) {
      setNotice({ tone: "error", text: "当前客户端不支持激活历史版本" });
      return;
    }
    setActivatingVersionId(activeVersionId);
    setNotice(null);
    try {
      const result = await api.activateVersion({ activeVersionId, draftRevision });
      setDraftRevision(result.draftRevision);
      setActiveVersionId(activeVersionId);
      setNotice({ tone: "status", text: "已激活所选历史版本；后续新运行将使用该版本。" });
    } catch (error) {
      const conflict = readConflict(error);
      setNotice({
        tone: "error",
        text: conflict === null ? "激活历史版本失败，请重试" : `Loop 已在其他位置更新，当前修订号 ${conflict}`,
      });
    } finally {
      setActivatingVersionId(null);
    }
  }

  return (
    <div
      data-loop-editor-layout="true"
      className="grid h-full min-h-0 grid-cols-1 grid-rows-[auto_minmax(360px,1fr)_auto_minmax(180px,auto)_auto] border-y border-[#d0d7de] bg-[#f6f8fa] md:grid-cols-[minmax(0,7fr)_minmax(260px,3fr)] md:grid-rows-[48px_minmax(0,1fr)_auto_auto]"
    >
      <div className="flex min-h-12 flex-wrap items-center gap-2 border-b border-[#d0d7de] bg-white px-3 py-2 md:col-span-2 md:py-0">
        <div className="mr-1 hidden min-w-0 lg:block">
          <div className="max-w-48 truncate text-xs font-semibold text-[#24292f]">{initial.definition.name}</div>
          <div className="text-xs text-[#6e7781]">草稿 r{draftRevision}</div>
          <div className="text-xs text-[#6e7781]">{scopeLabel}{readOnly ? " · 平台内置" : ""}</div>
        </div>
        {readOnly ? null : <div className="relative">
          <WorkbenchButton type="button" size="small" onClick={() => setMenuOpen((open) => !open)} aria-expanded={menuOpen}>
            <Plus aria-hidden="true" className="h-3.5 w-3.5" />
            添加节点
          </WorkbenchButton>
          {menuOpen ? (
            <div className="absolute left-0 top-9 z-20 grid w-44 border border-[#d0d7de] bg-white p-1 shadow-lg" role="menu">
              {NODE_CATALOG.filter((item) => item.type !== "subloop_call" || initial.definition.scope === "project").map((item) => (
                <button
                  key={item.type}
                  type="button"
                  role="menuitem"
                  className="px-2 py-1.5 text-left text-xs text-[#24292f] hover:bg-[#f6f8fa] disabled:text-[#8c959f]"
                  disabled={item.type === "start" || item.type === "end" || (item.type === "subloop_call" && (initial.subloopOptions?.length ?? 0) === 0)}
                  title={item.type === "subloop_call" && (initial.subloopOptions?.length ?? 0) === 0 ? "当前没有可用的已发布任务级 Loop" : undefined}
                  onClick={() => {
                    changeGraph((current) => insertNodeBeforeEnd(current, item.type, item.label, initial.subloopOptions ?? []));
                    setMenuOpen(false);
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>}
        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
          {notice ? (
            <span role={notice.tone === "error" ? "alert" : "status"} className={notice.tone === "error" ? "text-xs text-[#cf222e]" : "text-xs text-[#57606a]"}>
              {notice.text}
            </span>
          ) : dirty ? <span className="text-xs text-[#9a6700]">未保存</span> : null}
          {readOnly ? null : <WorkbenchButton type="button" size="small" disabled={history.length === 0} onClick={undo} aria-label="撤销">
            <Undo2 aria-hidden="true" className="h-3.5 w-3.5" />
          </WorkbenchButton>}
          {readOnly ? null : <WorkbenchButton type="button" size="small" disabled={future.length === 0} onClick={redo} aria-label="重做">
            <Redo2 aria-hidden="true" className="h-3.5 w-3.5" />
          </WorkbenchButton>}
          {readOnly ? null : <WorkbenchButton type="button" size="small" disabled={saving} onClick={saveDraft}>
            <Save aria-hidden="true" className="h-3.5 w-3.5" />
            {saving ? "保存中" : "保存草稿"}
          </WorkbenchButton>}
          {readOnly ? null : <WorkbenchButton
            type="button"
            size="small"
            variant="primary"
            disabled={validationErrors.length > 0 || dirty || saving || publishing}
            onClick={() => setPublishOpen(true)}
          >
            <Upload aria-hidden="true" className="h-3.5 w-3.5" />
            发布版本
          </WorkbenchButton>}
        </div>
      </div>

      <div className="min-h-0 min-w-0 md:col-start-1 md:row-start-2" aria-label="Loop 图画布">
        <ReactFlow
          key={compactLayout ? "compact" : "wide"}
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={{ loop: LoopNode }}
          fitView
          nodesDraggable={!readOnly}
          snapToGrid
          snapGrid={[16, 16]}
          onNodeClick={(_, node) => setSelection({ kind: "node", id: node.id })}
          onEdgeClick={(_, edge) => setSelection({ kind: "edge", id: edge.id })}
          onPaneClick={() => setSelection(null)}
          {...(readOnly ? {} : { onConnect: (connection: Connection) => changeGraph((current) => connectNodes(current, connection)) })}
        >
          <Background gap={16} size={1} color="#d8dee4" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <section aria-label="版本历史" className="border-t border-[#d0d7de] bg-white px-4 py-3 md:col-span-2 md:row-start-3">
        <h2 className="text-xs font-semibold text-[#24292f]">版本历史</h2>
        <p className="mt-1 text-xs leading-5 text-[#57606a]">仅影响后续新运行；已创建的运行继续使用各自的不可变快照。</p>
        <ol className="mt-3 grid gap-2">
          {initial.versions.flatMap((value) => {
            if (!value || typeof value !== "object" || Array.isArray(value)) return [];
            const version = value as Record<string, unknown>;
            const versionId = typeof version.id === "string" ? version.id : null;
            if (!versionId || !Number.isInteger(version.versionNumber)) return [];
            const active = versionId === activeVersionId;
            return [<li key={versionId} className="flex flex-wrap items-center gap-2 text-xs text-[#24292f]">
              <span>{`版本 ${version.versionNumber as number}`}</span>
              {active ? <span className="font-semibold text-[#1a7f37]">当前激活</span> : null}
              {readOnly || active ? null : <WorkbenchButton type="button" size="small" disabled={activatingVersionId !== null} onClick={() => void activateVersion(versionId)}>
                {activatingVersionId === versionId ? "激活中" : `激活历史版本 ${version.versionNumber as number}`}
              </WorkbenchButton>}
            </li>];
          })}
        </ol>
      </section>
      <div className={`h-full min-h-0 overflow-hidden md:col-start-2 md:row-start-2${readOnly ? " pointer-events-none opacity-75 [&>aside]:h-full" : ""}`}
      >
        <LoopInspector
          graph={graph}
          selection={selection}
          platformCaps={initial.platformCaps}
          subloopOptions={initial.subloopOptions ?? []}
          onLimitsChange={(limits) => changeGraph({ ...graph, limits })}
          onNodeChange={(node) => changeGraph({
            ...graph,
            nodes: graph.nodes.map((candidate) => candidate.key === node.key ? node : candidate),
          })}
          onResponsibilityChange={(nodeId, responsibility) => changeGraph((current) => (
            current.schemaVersion === 2
              ? {
                  ...current,
                  routingMetadata: {
                    ...current.routingMetadata,
                    [nodeId]: { responsibility },
                  },
                }
              : current
          ))}
          onEdgeChange={(edge) => changeGraph({
            ...graph,
            edges: graph.edges.map((candidate) => candidate.id === edge.id ? edge : candidate),
          })}
          onDelete={deleteSelection}
        />
      </div>
      <div className="md:col-span-2 md:row-start-4">
        <LoopValidationPanel errors={validationErrors} />
      </div>
      {publishOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#24292f66] p-4" role="presentation">
          <section className="w-full max-w-md rounded-md border border-[#d0d7de] bg-white shadow-xl" role="dialog" aria-modal="true" aria-label="确认发布 Loop 版本">
            <header className="flex items-center justify-between border-b border-[#d0d7de] px-4 py-3">
              <h2 className="text-sm font-semibold text-[#24292f]">确认发布 Loop 版本</h2>
              <button type="button" className="grid h-7 w-7 place-items-center" onClick={() => setPublishOpen(false)} aria-label="关闭发布确认">
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            </header>
            <div className="px-4 py-4 text-sm leading-6 text-[#57606a]">
              发布后图结构将成为不可变版本。当前草稿修订号为 <span className="font-mono text-[#24292f]">{draftRevision}</span>。
            </div>
            <footer className="flex justify-end gap-2 border-t border-[#d0d7de] px-4 py-3">
              <WorkbenchButton type="button" size="small" onClick={() => setPublishOpen(false)}>取消</WorkbenchButton>
              <WorkbenchButton type="button" size="small" variant="primary" disabled={publishing} onClick={publish}>
                {publishing ? "发布中" : "确认发布"}
              </WorkbenchButton>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function createNode(
  type: NodeCatalogType,
  key: string,
  label: string,
  subloopOptions: LoopEditorInitial["subloopOptions"] = [],
): LoopNodeDefinition {
  switch (type) {
    case "agent_action":
      return {
        key,
        label,
        type,
        executionTarget: "either",
        promptTemplate: "完成当前节点目标",
        reasoningEffort: DEFAULT_REASONING_EFFORT,
      };
    case "platform_action":
      return { key, label, type, executionTarget: "platform" };
    case "condition":
    case "policy_gate":
    case "human_gate":
    case "wait_callback":
      return { key, label, type, executionTarget: "platform" };
    case "subloop_call": {
      const option = subloopOptions[0];
      const version = option?.versions[0];
      if (!option || !version) return { key, label, type, executionTarget: "platform", targetLoopDefinitionId: "missing", targetLoopVersionId: "missing", inputMapping: {}, terminalOutcomeMapping: { success: "success", failure: "failure" } };
      return {
        key,
        label,
        type,
        executionTarget: "platform",
        targetLoopDefinitionId: option.definitionId,
        targetLoopVersionId: version.id,
        inputMapping: {},
        terminalOutcomeMapping: { success: "success", failure: "failure" },
      };
    }
    case "start":
    case "end":
      return { key, label, type };
  }
}

function insertNodeBeforeEnd(graph: LoopAuthoringGraph, type: NodeCatalogType, label: string, subloopOptions: LoopEditorInitial["subloopOptions"] = []): LoopAuthoringGraph {
  const end = graph.nodes.find((node) => node.type === "end");
  if (!end || type === "start" || type === "end") return graph;
  const keyBase = type.replace(/_/gu, "-");
  let suffix = graph.nodes.length + 1;
  while (graph.nodes.some((node) => node.key === `${keyBase}-${suffix}`)) suffix += 1;
  const key = `${keyBase}-${suffix}`;
  const incoming = graph.edges.find((edge) => edge.target === end.key && edge.kind !== "feedback");
  if (!incoming) return graph;
  const node = createNode(type, key, label, subloopOptions);
  return {
    ...graph,
    nodes: [...graph.nodes.filter((candidate) => candidate.key !== end.key), node, end],
    edges: [
      ...graph.edges.filter((edge) => edge.id !== incoming.id),
      { ...incoming, id: `${incoming.source}-${key}`, target: key },
      { id: `${key}-${end.key}`, source: key, target: end.key, kind: "normal", outcome: "success" },
    ],
    ...(graph.schemaVersion === 2 ? {
      routingMetadata: {
        ...graph.routingMetadata,
        [stableNodeId(node)]: { responsibility: "" },
      },
    } : {}),
  };
}

function collectValidationErrors(
  graph: LoopAuthoringGraph,
  caps: LoopEditorInitial["platformCaps"],
  projectScope = false,
  subloopOptions: NonNullable<LoopEditorInitial["subloopOptions"]> = [],
): string[] {
  const messages: string[] = [];
  if (graph.edges.some((edge) => edge.kind === "feedback" && edge.maxTraversals === undefined)) {
    messages.push("返工边必须设置最大经过次数");
  }
  if (graph.nodes.length > caps.maxStages) {
    messages.push(`节点数量 ${graph.nodes.length} 超过平台上限 ${caps.maxStages}`);
  }
  if (graph.schemaVersion === 2) {
    const nodesByKey = new Map(graph.nodes.map((node) => [node.key, node]));
    for (const node of graph.nodes) {
      if (node.type === "start" || node.type === "end") continue;
      if (!(graph.routingMetadata[stableNodeId(node)]?.responsibility.trim())) {
        messages.push(`节点 ${node.label} 必须填写职责`);
      }
      const targets = graph.edges
        .filter((edge) => edge.source === node.key)
        .map((edge) => nodesByKey.get(edge.target))
        .filter((target): target is LoopNodeDefinition => target !== undefined)
        .map(stableNodeId);
      if (targets.length === 0) messages.push(`节点 ${node.label} 必须至少配置一个路由目标`);
      if (new Set(targets).size !== targets.length) messages.push(`节点 ${node.label} 不能重复路由到同一目标`);
    }
  }
  for (const node of graph.nodes) {
    if (node.type !== "subloop_call") continue;
    if (!projectScope) messages.push("任务级 Loop 不能调用任务 SubLoop");
    const option = subloopOptions.find((candidate) => candidate.definitionId === node.targetLoopDefinitionId);
    if (!option) {
      messages.push(`任务 SubLoop ${node.label} 未选择可用的任务级 Loop`);
    } else if (!option.versions.some((version) => version.id === node.targetLoopVersionId)) {
      messages.push(`任务 SubLoop ${node.label} 的版本不可用`);
    }
  }
  const validation = validateLoopGraph(graph);
  if (!validation.ok) {
    for (const error of validation.errors) {
      if (error.includes("Feedback edge requires maxTraversals")) continue;
      if (error.includes("Too big") && error.startsWith("nodes")) continue;
      if (/responsibility is required|requires at least one route target|has duplicate route targets/iu.test(error)) continue;
      messages.push(error);
    }
  }
  return [...new Set(messages)];
}

function toFlowNodes(
  graph: LoopAuthoringGraph,
  selection: LoopEditorSelection,
  compactLayout: boolean,
): Array<Node<LoopFlowNodeData>> {
  const positions = layoutLoopNodes({
    nodes: graph.nodes.map((node) => node.key),
    edges: graph.edges,
    compact: compactLayout,
  });
  return graph.nodes.map((node, index) => ({
    id: node.key,
    type: "loop",
    selected: selection?.kind === "node" && selection.id === node.key,
    position: positions[node.key] ?? getLoopNodePosition(index, compactLayout),
    data: {
      label: node.label,
      node,
      responsibility: graph.schemaVersion === 2
        ? graph.routingMetadata[stableNodeId(node)]?.responsibility
        : undefined,
    },
  }));
}

export function getLoopNodePosition(index: number, compactLayout: boolean): { x: number; y: number } {
  return compactLayout
    ? { x: 72, y: 48 + index * 150 }
    : { x: 64 + index * 240, y: 120 + (index % 2) * 96 };
}

function readCompactLayout(): boolean {
  return typeof window.matchMedia === "function"
    ? window.matchMedia("(max-width: 767px)").matches
    : false;
}

function subscribeCompactLayout(callback: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const query = window.matchMedia("(max-width: 767px)");
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

function toFlowEdges(graph: LoopAuthoringGraph, selection: LoopEditorSelection): Edge[] {
  return graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.outcome,
    selected: selection?.kind === "edge" && selection.id === edge.id,
    animated: edge.kind === "feedback",
    markerEnd: { type: MarkerType.ArrowClosed },
    style: {
      stroke: edge.kind === "feedback" ? "#9ba8a1" : "#5d6963",
      ...(edge.kind === "feedback" ? { strokeDasharray: "6 4" } : {}),
    },
  }));
}

function connectNodes(graph: LoopAuthoringGraph, connection: Connection): LoopAuthoringGraph {
  if (!connection.source || !connection.target || connection.source === connection.target) return graph;
  const idBase = `${connection.source}-${connection.target}`;
  let id = idBase;
  let suffix = 2;
  while (graph.edges.some((edge) => edge.id === id)) {
    id = `${idBase}-${suffix}`;
    suffix += 1;
  }
  return {
    ...graph,
    edges: [...graph.edges, {
      id,
      source: connection.source,
      target: connection.target,
      kind: "normal",
      outcome: "success",
    }],
  };
}

function readConflict(error: unknown): number | null {
  if (!error || typeof error !== "object" || Reflect.get(error, "code") !== "version_conflict") return null;
  const currentRevision = Reflect.get(error, "currentRevision");
  return typeof currentRevision === "number" && Number.isInteger(currentRevision)
    ? currentRevision
    : null;
}

function createBrowserLoopEditorApi(initial: LoopEditorInitial): LoopEditorApi {
  return {
    async saveDraft({ graph, draftRevision }) {
      const response = await fetch(`/api/loops/${encodeURIComponent(initial.definition.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          commandId: crypto.randomUUID(),
          expectedRevision: draftRevision,
          name: initial.definition.name,
          description: initial.definition.description,
          graph,
        }),
      });
      const body = await readApiResponse(response);
      return body.result as { draftRevision: number };
    },
    async publish({ draftRevision }) {
      const response = await fetch(`/api/loops/${encodeURIComponent(initial.definition.id)}/publish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          commandId: crypto.randomUUID(),
          expectedRevision: draftRevision,
        }),
      });
      const body = await readApiResponse(response);
      return body.result as { versionNumber: number; checksum: string };
    },
    async activateVersion({ activeVersionId, draftRevision }) {
      const response = await fetch(`/api/loops/${encodeURIComponent(initial.definition.id)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ commandId: crypto.randomUUID(), expectedRevision: draftRevision, activeVersionId }),
      });
      const body = await readApiResponse(response);
      return body.result as { draftRevision: number };
    },
  };
}

async function readApiResponse(response: Response): Promise<{ result: unknown }> {
  const body = await response.json() as {
    ok?: boolean;
    result?: unknown;
    code?: string;
    error?: string;
    currentRevision?: number;
  };
  if (response.ok && body.ok && "result" in body) return { result: body.result };
  throw Object.assign(new Error(body.error ?? "Loop request failed"), {
    code: body.code ?? `http_${response.status}`,
    ...(body.currentRevision === undefined ? {} : { currentRevision: body.currentRevision }),
  });
}
