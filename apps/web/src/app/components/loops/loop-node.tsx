"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { LoopNodeDefinition } from "@humanthread/orchestration-core";
import {
  Bot,
  CircleCheck,
  CircleDot,
  Clock3,
  GitBranch,
  MonitorCog,
  ShieldCheck,
  UserRoundCheck,
  Workflow,
} from "lucide-react";

const NODE_META = {
  start: { icon: CircleDot, caption: "入口" },
  agent_action: { icon: Bot, caption: "本地 / Agent" },
  platform_action: { icon: MonitorCog, caption: "平台执行" },
  condition: { icon: GitBranch, caption: "条件路由" },
  policy_gate: { icon: ShieldCheck, caption: "自动门禁" },
  human_gate: { icon: UserRoundCheck, caption: "人工确认" },
  wait_callback: { icon: Clock3, caption: "等待事件" },
  subloop_call: { icon: Workflow, caption: "任务 SubLoop" },
  end: { icon: CircleCheck, caption: "终点" },
} as const;

export type LoopFlowNodeData = {
  label: string;
  node: LoopNodeDefinition;
  responsibility?: string | undefined;
};

export function LoopNode({ data, selected }: NodeProps) {
  const nodeData = data as LoopFlowNodeData;
  const meta = NODE_META[nodeData.node.type];
  const Icon = meta.icon;
  const isTerminal = nodeData.node.type === "end";
  const isStart = nodeData.node.type === "start";

  return (
    <div
      className={[
        "h-[94px] w-[184px] border bg-white shadow-[0_1px_2px_rgba(31,35,40,0.08)]",
        selected ? "border-[#1f883d] ring-2 ring-[#1f883d33]" : "border-[#d0d7de]",
      ].join(" ")}
    >
      {!isStart ? (
        <Handle
          type="target"
          position={Position.Left}
          aria-label={`${nodeData.label} 输入`}
          className="!h-2.5 !w-2.5 !border-2 !border-white !bg-[#57606a]"
        />
      ) : null}
      <div className="flex items-center gap-2 border-b border-[#d8dee4] bg-[#f6f8fa] px-3 py-2">
        <Icon aria-hidden="true" className="h-4 w-4 text-[#57606a]" />
        <span className="truncate text-xs font-semibold text-[#24292f]">{nodeData.label}</span>
      </div>
      <div className="grid h-[58px] content-start gap-1 px-3 py-2 text-[11px] text-[#6e7781]">
        <div>{meta.caption}</div>
        {isStart || isTerminal ? null : (
          <div
            className={nodeData.responsibility?.trim() ? "truncate text-[#57606a]" : "truncate text-[#9a6700]"}
            title={nodeData.responsibility?.trim() || "职责未配置"}
          >
            {nodeData.responsibility?.trim() || "职责未配置"}
          </div>
        )}
      </div>
      {!isTerminal ? (
        <Handle
          type="source"
          position={Position.Right}
          aria-label={`${nodeData.label} 输出`}
          className="!h-2.5 !w-2.5 !border-2 !border-white !bg-[#1f883d]"
        />
      ) : null}
    </div>
  );
}
