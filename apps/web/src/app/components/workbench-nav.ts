export const WORKBENCH_NAV_ITEMS = [
  {
    href: "/dashboard",
    label: "我的工作台",
    compactLabel: "首页",
    key: "workbench",
    icon: "home",
  },
  {
    href: "/tasks",
    label: "任务中心",
    compactLabel: "任务",
    key: "tasks",
    icon: "tasks",
  },
  {
    href: "/agents",
    label: "Agent 中心",
    compactLabel: "Agent",
    key: "agents",
    icon: "agent",
  },
  {
    href: "/live-sessions",
    label: "在线会话",
    compactLabel: "会话",
    key: "live-sessions",
    icon: "agent",
  },
  {
    href: "/loops",
    label: "Loop 中心",
    compactLabel: "Loop",
    key: "loops",
    icon: "loop",
  },
  {
    href: "/loop-runs",
    label: "运行记录",
    compactLabel: "运行",
    key: "loop-runs",
    icon: "chart",
  },
  {
    href: "/notifications",
    label: "通知中心",
    compactLabel: "提醒",
    key: "notifications",
    icon: "bell",
  },
  {
    href: "/team",
    label: "团队协作",
    compactLabel: "团队",
    key: "team",
    icon: "users",
  },
  {
    href: "/projects",
    label: "项目空间",
    compactLabel: "项目",
    key: "projects",
    icon: "folder",
  },
  {
    href: "/documents",
    label: "文档中心",
    compactLabel: "文档",
    key: "documents",
    icon: "book",
  },
  {
    href: "/reports",
    label: "报表复盘",
    compactLabel: "报表",
    key: "reports",
    icon: "chart",
  },
  {
    href: "/templates",
    label: "模板库",
    compactLabel: "模板",
    key: "templates",
    icon: "layers",
  },
  {
    href: "/settings/account",
    label: "设置",
    compactLabel: "设置",
    key: "settings",
    icon: "settings",
  },
] as const;

export const WORKBENCH_NAV_GROUPS = [
  { key: "推进", label: "推进", items: ["workbench", "tasks", "notifications"] },
  { key: "自动化", label: "自动化", items: ["loops", "agents", "live-sessions", "loop-runs"] },
  { key: "协作", label: "协作", items: ["projects", "team", "documents"] },
  { key: "复盘", label: "复盘", items: ["reports", "templates", "settings"] },
] as const;

export type WorkbenchNavGroup = (typeof WORKBENCH_NAV_GROUPS)[number];

export type WorkbenchNavItem = (typeof WORKBENCH_NAV_ITEMS)[number];
export type WorkbenchNavKey = WorkbenchNavItem["key"];
