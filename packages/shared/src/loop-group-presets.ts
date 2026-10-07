export interface LoopGroupPreset {
  key: string;
  taskLoopIds: readonly string[];
  defaultTaskLoopId: string;
  projectLoopIds: readonly string[];
  defaultProjectLoopId: string;
  projectLoopNodeTaskLoopIds?: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

export interface LoopGroupSelection {
  selectedPresetKeys: string[];
  defaultPresetKey: string;
}

import { z } from "zod";

const loopIdSchema = z.string().trim().min(1).max(96);
export const loopGroupPresetSchema = z.object({
  key: z.string().trim().min(1).max(96),
  taskLoopIds: z.array(loopIdSchema).max(128),
  defaultTaskLoopId: loopIdSchema,
  projectLoopIds: z.array(loopIdSchema).min(1).max(128),
  defaultProjectLoopId: loopIdSchema,
  projectLoopNodeTaskLoopIds: z.record(z.string().trim().min(1).max(96), z.record(z.string().trim().min(1).max(96), loopIdSchema)).optional(),
}).strict();

export const loopGroupSelectionSchema = z.object({
  selectedPresetKeys: z.array(z.string().trim().min(1).max(96)).min(1).max(32),
  defaultPresetKey: z.string().trim().min(1).max(96),
}).strict().superRefine((selection, context) => {
  if (new Set(selection.selectedPresetKeys).size !== selection.selectedPresetKeys.length) {
    context.addIssue({ code: "custom", message: "Loop 组预设不能重复选择", path: ["selectedPresetKeys"] });
  }
  if (!selection.selectedPresetKeys.includes(selection.defaultPresetKey)) {
    context.addIssue({ code: "custom", message: "默认 Loop 组预设必须来自已选择的预设", path: ["defaultPresetKey"] });
  }
});

export interface LoopGroupApplication {
  selectedPresetKeys: string[];
  defaultPresetKey: string;
  taskLoopIds: string[];
  defaultTaskLoopId: string;
  projectLoopIds: string[];
  defaultProjectLoopId: string;
  projectLoopNodeTaskLoopIds?: Record<string, Record<string, string>>;
}

export const projectLoopGroupConfigSchema = z.object({
  taskLoopVersionIds: z.array(loopIdSchema).max(128),
  defaultTaskLoopVersionId: loopIdSchema,
  projectLoopVersionIds: z.array(loopIdSchema).min(1).max(128),
  defaultProjectLoopVersionId: loopIdSchema,
  selectedPresetKeys: z.array(z.string().trim().min(1).max(96)).min(1).max(32),
  defaultPresetKey: z.string().trim().min(1).max(96),
  projectLoopNodeTaskLoopIds: z.record(z.string().trim().min(1).max(96), z.record(z.string().trim().min(1).max(96), loopIdSchema)).optional(),
}).strict().superRefine((config, context) => {
  if (!config.projectLoopVersionIds.includes(config.defaultTaskLoopVersionId)) {
    context.addIssue({ code: "custom", message: "默认任务 Loop 必须来自项目 Loop 组", path: ["defaultTaskLoopVersionId"] });
  }
  if (!config.projectLoopVersionIds.includes(config.defaultProjectLoopVersionId)) {
    context.addIssue({ code: "custom", message: "默认 Project Loop 必须来自项目 Loop 组", path: ["defaultProjectLoopVersionId"] });
  }
  if (!config.selectedPresetKeys.includes(config.defaultPresetKey)) {
    context.addIssue({ code: "custom", message: "默认 Loop 组预设必须来自已选择的预设", path: ["defaultPresetKey"] });
  }
});

export type ProjectLoopGroupConfig = z.infer<typeof projectLoopGroupConfigSchema>;

export function buildProjectLoopGroupConfig(input: {
  presets: readonly LoopGroupPreset[];
  selection: LoopGroupSelection;
}): ProjectLoopGroupConfig {
  const application = buildLoopGroupApplication({
    presets: input.presets,
    selectedKeys: input.selection.selectedPresetKeys,
    defaultPresetKey: input.selection.defaultPresetKey,
  });
  return projectLoopGroupConfigSchema.parse({
    taskLoopVersionIds: application.taskLoopIds,
    defaultTaskLoopVersionId: application.defaultTaskLoopId,
    projectLoopVersionIds: application.projectLoopIds,
    defaultProjectLoopVersionId: application.defaultProjectLoopId,
    selectedPresetKeys: application.selectedPresetKeys,
    defaultPresetKey: application.defaultPresetKey,
    ...(application.projectLoopNodeTaskLoopIds && Object.keys(application.projectLoopNodeTaskLoopIds).length > 0 ? { projectLoopNodeTaskLoopIds: application.projectLoopNodeTaskLoopIds } : {}),
  });
}

export function buildLoopGroupApplication(input: {
  presets: readonly LoopGroupPreset[];
  selectedKeys: readonly string[];
  defaultPresetKey?: string;
}): LoopGroupApplication {
  if (input.selectedKeys.length === 0) throw new Error("至少选择一个 Loop 组预设");
  if (new Set(input.selectedKeys).size !== input.selectedKeys.length) {
    throw new Error("Loop 组预设不能重复选择");
  }
  const presetByKey = new Map(input.presets.map((preset) => [preset.key, preset]));
  const selected = input.selectedKeys.map((key) => {
    const preset = presetByKey.get(key);
    if (!preset) throw new Error(`Loop 组预设不存在: ${key}`);
    validatePreset(preset);
    return preset;
  });
  const defaultPresetKey = input.defaultPresetKey ?? selected[0]!.key;
  if (!input.selectedKeys.includes(defaultPresetKey)) {
    throw new Error("默认 Loop 组预设必须来自已选择的预设");
  }
  const defaultPreset = presetByKey.get(defaultPresetKey)!;
  const projectLoopIds = unique(selected.flatMap((preset) => preset.projectLoopIds));
  const taskLoopIds = unique(selected.flatMap((preset) => preset.taskLoopIds));
  const projectLoopNodeTaskLoopIds = sanitizeProjectLoopNodeTaskLoopIds(
    mergeNodeMappings(selected.map((preset) => preset.projectLoopNodeTaskLoopIds)),
    { projectLoopIds, taskLoopIds },
  );
  return {
    selectedPresetKeys: [...input.selectedKeys],
    defaultPresetKey,
    taskLoopIds,
    defaultTaskLoopId: defaultPreset.defaultTaskLoopId,
    projectLoopIds,
    defaultProjectLoopId: defaultPreset.defaultProjectLoopId,
    ...(Object.keys(projectLoopNodeTaskLoopIds).length > 0 ? { projectLoopNodeTaskLoopIds } : {}),
  };
}

export function sanitizeProjectLoopNodeTaskLoopIds(
  value: unknown,
  available: { projectLoopIds: readonly string[]; taskLoopIds: readonly string[] },
): Record<string, Record<string, string>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const projectIds = new Set(available.projectLoopIds);
  const taskIds = new Set(available.taskLoopIds);
  const result: Record<string, Record<string, string>> = {};
  for (const [projectId, rawNodes] of Object.entries(value)) {
    if (!projectIds.has(projectId) || !rawNodes || typeof rawNodes !== "object" || Array.isArray(rawNodes)) continue;
    const nodes: Record<string, string> = {};
    for (const [nodeKey, taskId] of Object.entries(rawNodes)) {
      if (nodeKey.trim() && typeof taskId === "string" && taskIds.has(taskId)) nodes[nodeKey] = taskId;
    }
    if (Object.keys(nodes).length > 0) result[projectId] = nodes;
  }
  return result;
}

function mergeNodeMappings(mappings: readonly (Readonly<Record<string, Readonly<Record<string, string>>>> | undefined)[]): Record<string, Record<string, string>> {
  const merged: Record<string, Record<string, string>> = {};
  for (const mapping of mappings) for (const [projectId, nodes] of Object.entries(mapping ?? {})) merged[projectId] = { ...(merged[projectId] ?? {}), ...nodes };
  return merged;
}

function validatePreset(preset: LoopGroupPreset): void {
  if (!preset.key.trim()) throw new Error("Loop 组预设名称不能为空");
  if (preset.projectLoopIds.length === 0 || !preset.projectLoopIds.includes(preset.defaultTaskLoopId)) {
    throw new Error(`预设 ${preset.key} 的默认任务 Loop 不在项目 Loop 组中`);
  }
  if (preset.projectLoopIds.length === 0 || !preset.projectLoopIds.includes(preset.defaultProjectLoopId)) {
    throw new Error(`预设 ${preset.key} 的默认 Project Loop 不在项目 Loop 组中`);
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
