/**
 * Platform actions are the only operations a `platform_action` node may
 * delegate to the platform runtime. The authoring editor, the graph validator
 * and the orchestration worker all read this catalog so a published graph can
 * never reference an action the runtime cannot execute.
 */
export const PLATFORM_ACTION_DEFINITIONS = [
  {
    key: "project_document.write",
    label: "写入项目文档",
    description: "按发布配置写入指定项目文档并产生版本回执。",
  },
  {
    key: "milestone.release.snapshot",
    label: "里程碑发布快照",
    description: "固化里程碑发布快照，并把快照传递给下一节点。",
  },
  {
    key: "task_loop.invoke",
    label: "调用任务 SubLoop",
    description: "以当前 Loop 为父节点调用任务作用域的子 Loop 并等待终态。",
  },
] as const;

export type PlatformActionKey = (typeof PLATFORM_ACTION_DEFINITIONS)[number]["key"];

export const PLATFORM_ACTION_KEYS: readonly PlatformActionKey[] =
  PLATFORM_ACTION_DEFINITIONS.map((definition) => definition.key);

export function isPlatformActionKey(value: unknown): value is PlatformActionKey {
  return typeof value === "string" && PLATFORM_ACTION_KEYS.includes(value as PlatformActionKey);
}
