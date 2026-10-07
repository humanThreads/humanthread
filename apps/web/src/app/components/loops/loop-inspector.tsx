"use client";

import type {
  LoopEdgeDefinition,
  LoopAuthoringGraph,
  LoopNodeDefinition,
} from "@humanthread/orchestration-core";
import {
  DEFAULT_REASONING_EFFORT,
  PLATFORM_ACTION_DEFINITIONS,
  reasoningEffortSchema,
  stableNodeId,
} from "@humanthread/orchestration-core";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { WorkbenchButton } from "../workbench-ui";

export type LoopEditorSelection = { kind: "node" | "edge"; id: string } | null;

const REQUIREMENT_CONVERSATION_POLICY: NonNullable<
  Extract<LoopNodeDefinition, { type: "agent_action" }>["interactionPolicy"]
> = {
  kind: "requirement_conversation",
  replyRoles: ["task_collaborator", "task_assignee", "task_creator", "project_admin"],
  confirmRoles: ["task_assignee", "task_creator", "project_admin"],
  structuredFields: [],
};

export function LoopInspector({
  graph,
  selection,
  platformCaps,
  onLimitsChange,
  onNodeChange,
  onResponsibilityChange,
  onEdgeChange,
  onDelete,
  subloopOptions,
}: {
  graph: LoopAuthoringGraph;
  selection: LoopEditorSelection;
  platformCaps: { maxStages: number; maxRepeatCount: number };
  onLimitsChange(limits: LoopAuthoringGraph["limits"]): void;
  onNodeChange(node: LoopNodeDefinition): void;
  onResponsibilityChange(nodeId: string, responsibility: string): void;
  onEdgeChange(edge: LoopEdgeDefinition): void;
  onDelete(): void;
  subloopOptions: Array<{
    definitionId: string;
    name: string;
    versions: Array<{ id: string; versionNumber: number }>;
  }>;
}) {
  const node = selection?.kind === "node"
    ? graph.nodes.find((candidate) => candidate.key === selection.id)
    : undefined;
  const edge = selection?.kind === "edge"
    ? graph.edges.find((candidate) => candidate.id === selection.id)
    : undefined;

  return (
    <aside className="min-h-0 overflow-y-auto border-t border-[#d0d7de] bg-white md:border-l md:border-t-0" aria-label="Loop 属性检查器">
      <div className="border-b border-[#d0d7de] px-4 py-3">
        <h2 className="text-xs font-semibold text-[#24292f]">运行限制</h2>
      </div>
      <div className="grid gap-3 border-b border-[#d0d7de] px-4 py-3">
        <NumberField
          label="最大 Stage 数"
          value={graph.limits.maxStages}
          min={1}
          max={platformCaps.maxStages}
          onChange={(maxStages) => onLimitsChange({ ...graph.limits, maxStages })}
        />
        <NumberField
          label="最大返工次数"
          value={graph.limits.maxRepeatCount}
          min={1}
          max={platformCaps.maxRepeatCount}
          onChange={(maxRepeatCount) => onLimitsChange({ ...graph.limits, maxRepeatCount })}
        />
      </div>

      {node ? (
        <div className="grid gap-3 px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xs font-semibold text-[#24292f]">节点属性</h2>
            {node.type !== "start" && node.type !== "end" ? (
              <WorkbenchButton type="button" size="small" variant="danger" onClick={onDelete} aria-label="删除节点">
                <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
              </WorkbenchButton>
            ) : null}
          </div>
          <TextField
            label="节点名称"
            value={node.label}
            onChange={(label) => onNodeChange({ ...node, label })}
          />
          <ReadOnlyField label="节点 Key" value={node.key} />
          <ReadOnlyField label="节点类型" value={node.type} />
          {graph.schemaVersion === 2 && node.type !== "start" && node.type !== "end" ? (
            <>
              <TextAreaField
                label="节点职责"
                value={graph.routingMetadata[stableNodeId(node)]?.responsibility ?? ""}
                maxLength={4_000}
                required
                onChange={(responsibility) => onResponsibilityChange(stableNodeId(node), responsibility)}
              />
              <ReadOnlyField
                label="允许路由目标"
                value={resolveAllowedRouteTargets(graph, node)}
              />
            </>
          ) : null}
          {node.type === "agent_action" ? (
            <>
              <TextAreaField
                label="Agent 指令"
                value={node.promptTemplate}
                onChange={(promptTemplate) => onNodeChange({ ...node, promptTemplate })}
              />
              <label className="text-xs font-medium text-[#57606a]">
                推理强度
                <select
                  aria-label="推理强度"
                  value={node.reasoningEffort ?? DEFAULT_REASONING_EFFORT}
                  className={FIELD_CLASS}
                  onChange={(event) => onNodeChange({
                    ...node,
                    reasoningEffort: reasoningEffortSchema.parse(event.currentTarget.value),
                  })}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High（产品默认）</option>
                  <option value="xhigh">XHigh</option>
                  <option value="max">Max</option>
                  <option value="ultra">Ultra</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-xs font-medium text-[#24292f]">
                <input
                  aria-label="允许需求沟通"
                  type="checkbox"
                  checked={node.interactionPolicy?.kind === "requirement_conversation"}
                  onChange={(event) => {
                    if (event.currentTarget.checked) {
                      onNodeChange({ ...node, interactionPolicy: REQUIREMENT_CONVERSATION_POLICY });
                      return;
                    }
                    const nodeWithoutInteractionPolicy = { ...node };
                    delete nodeWithoutInteractionPolicy.interactionPolicy;
                    onNodeChange(nodeWithoutInteractionPolicy);
                  }}
                />
                允许需求沟通
              </label>
            </>
          ) : null}
          {node.type === "subloop_call" ? (
            <SubloopFields node={node} options={subloopOptions} onNodeChange={onNodeChange} />
          ) : null}
          {node.type === "platform_action" ? (
            <>
              <label className="text-xs font-medium text-[#57606a]">
                平台操作类型
                <select
                  aria-label="平台操作类型"
                  value={node.action ?? ""}
                  className={FIELD_CLASS}
                  onChange={(event) => {
                    const action = event.currentTarget.value;
                    if (action) {
                      onNodeChange({ ...node, action });
                      return;
                    }
                    const nodeWithoutAction = { ...node };
                    delete nodeWithoutAction.action;
                    onNodeChange(nodeWithoutAction);
                  }}
                >
                  <option value="">请选择平台操作</option>
                  {PLATFORM_ACTION_DEFINITIONS.map((definition) => (
                    <option key={definition.key} value={definition.key}>{definition.label}</option>
                  ))}
                </select>
              </label>
              {node.action ? (
                <p className="text-xs text-[#57606a]">
                  {PLATFORM_ACTION_DEFINITIONS.find((definition) => definition.key === node.action)?.description
                    ?? "该平台操作未注册，发布前必须改选支持的平台操作。"}
                </p>
              ) : null}
              <p className="text-xs text-[#57606a]">
                需要作者审批确认时，应改为「人工确认」节点。
              </p>
            </>
          ) : null}
        </div>
      ) : null}

      {edge ? (
        <div className="grid gap-3 px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xs font-semibold text-[#24292f]">连接属性</h2>
            <WorkbenchButton type="button" size="small" variant="danger" onClick={onDelete} aria-label="删除连接">
              <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
            </WorkbenchButton>
          </div>
          <ReadOnlyField label="路由结果" value={edge.outcome} />
          <ReadOnlyField label="连接类型" value={edge.kind} />
          {edge.kind === "feedback" ? (
            <NumberField
              label="最大经过次数"
              value={edge.maxTraversals ?? 1}
              min={1}
              max={graph.limits.maxRepeatCount}
              onChange={(maxTraversals) => onEdgeChange({ ...edge, maxTraversals })}
            />
          ) : null}
        </div>
      ) : null}

      {!selection ? (
        <p className="px-4 py-3 text-xs leading-5 text-[#6e7781]">选择节点或连接以编辑详细属性。</p>
      ) : null}
    </aside>
  );
}

function SubloopFields({
  node,
  options,
  onNodeChange,
}: {
  node: Extract<LoopNodeDefinition, { type: "subloop_call" }>;
  options: Array<{ definitionId: string; name: string; versions: Array<{ id: string; versionNumber: number }> }>;
  onNodeChange(node: LoopNodeDefinition): void;
}) {
  const selectedOption = options.find((option) => option.definitionId === node.targetLoopDefinitionId);
  return <>
    <label className="text-xs font-medium text-[#57606a]">
      任务级 Loop
      <select
        aria-label="任务级 Loop"
        value={node.targetLoopDefinitionId}
        className={FIELD_CLASS}
        onChange={(event) => {
          const option = options.find((candidate) => candidate.definitionId === event.currentTarget.value);
          const version = option?.versions[0];
          if (!option || !version) return;
          onNodeChange({ ...node, targetLoopDefinitionId: option.definitionId, targetLoopVersionId: version.id });
        }}
      >
        {options.length === 0 ? <option value="">暂无已发布任务级 Loop</option> : null}
        {options.map((option) => <option key={option.definitionId} value={option.definitionId}>{option.name}</option>)}
      </select>
    </label>
    <label className="text-xs font-medium text-[#57606a]">
      任务级 Loop 版本
      <select
        aria-label="任务级 Loop 版本"
        value={node.targetLoopVersionId}
        className={FIELD_CLASS}
        disabled={!selectedOption}
        onChange={(event) => onNodeChange({ ...node, targetLoopVersionId: event.currentTarget.value })}
      >
        {(selectedOption?.versions ?? []).map((version) => <option key={version.id} value={version.id}>v{version.versionNumber}</option>)}
      </select>
    </label>
    <ReadOnlyField label="输入映射" value={JSON.stringify(node.inputMapping)} />
    <ReadOnlyField label="终态路由映射" value={formatOutcomeMapping(node.terminalOutcomeMapping)} />
  </>;
}

function formatOutcomeMapping(mapping: Record<string, string>): string {
  const entries = Object.entries(mapping);
  return entries.length > 0
    ? entries.map(([source, target]) => `${source} -> ${target}`).join("；")
    : "未配置";
}

function resolveAllowedRouteTargets(graph: LoopAuthoringGraph, node: LoopNodeDefinition): string {
  const nodesByKey = new Map(graph.nodes.map((candidate) => [candidate.key, candidate]));
  const targets = graph.edges
    .filter((edge) => edge.source === node.key)
    .map((edge) => nodesByKey.get(edge.target))
    .filter((target): target is LoopNodeDefinition => target !== undefined)
    .map(stableNodeId);
  return targets.length > 0 ? targets.join("、") : "未配置";
}

const FIELD_CLASS = "mt-1 w-full rounded-md border border-[#d0d7de] bg-white px-2 py-1.5 text-xs text-[#24292f] outline-none focus:border-[#1f883d] focus:ring-2 focus:ring-[#1f883d22]";

function NumberField({ label, value, min, max, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange(value: number): void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [previousValue, setPreviousValue] = useState(value);

  if (value !== previousValue) {
    setPreviousValue(value);
    if (Number(draft) !== value) setDraft(String(value));
  }

  return (
    <label className="text-xs font-medium text-[#57606a]">
      {label}
      <input
        aria-label={label}
        type="number"
        value={draft}
        min={min}
        max={max}
        className={FIELD_CLASS}
        onChange={(event) => {
          setDraft(event.currentTarget.value);
          const next = event.currentTarget.valueAsNumber;
          if (Number.isInteger(next)) onChange(next);
        }}
      />
    </label>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange(value: string): void }) {
  return (
    <label className="text-xs font-medium text-[#57606a]">
      {label}
      <input aria-label={label} value={value} className={FIELD_CLASS} onChange={(event) => onChange(event.currentTarget.value)} />
    </label>
  );
}

function TextAreaField({ label, value, maxLength, required = false, onChange }: {
  label: string;
  value: string;
  maxLength?: number;
  required?: boolean;
  onChange(value: string): void;
}) {
  return (
    <label className="text-xs font-medium text-[#57606a]">
      {label}
      <textarea
        aria-label={label}
        value={value}
        rows={5}
        maxLength={maxLength}
        required={required}
        aria-invalid={required && value.trim().length === 0}
        className={FIELD_CLASS}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </label>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-xs">
      <div className="font-medium text-[#57606a]">{label}</div>
      <div className="mt-1 break-all font-mono text-[11px] text-[#24292f]">{value}</div>
    </div>
  );
}
