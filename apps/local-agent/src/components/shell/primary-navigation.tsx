import {
  Bell,
  Bot,
  FileText,
  FolderKanban,
  LayoutDashboard,
  ListChecks,
  ListTodo,
  Settings,
  TableProperties,
  Users,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";
import { NavLink } from "react-router-dom";
import type { WorkbenchNavigationKey } from "@humanthread/workbench-client";

export type DesktopNavigationKey = WorkbenchNavigationKey | "onboarding";

interface NavigationItem {
  key: DesktopNavigationKey;
  label: string;
  to: string;
  icon: LucideIcon;
}

interface NavigationGroup {
  label: string;
  items: NavigationItem[];
}

export const PRIMARY_NAVIGATION_GROUPS: NavigationGroup[] = [
  {
    label: "工作",
    items: [
      { key: "dashboard", label: "首页", to: "/dashboard", icon: LayoutDashboard },
      { key: "tasks", label: "任务", to: "/tasks", icon: ListTodo },
      { key: "agents", label: "Agents", to: "/agents", icon: Bot },
    ],
  },
  {
    label: "协作",
    items: [
      { key: "projects", label: "项目", to: "/projects", icon: FolderKanban },
      { key: "documents", label: "文档", to: "/documents", icon: FileText },
      { key: "notifications", label: "通知", to: "/notifications", icon: Bell },
      { key: "team", label: "团队", to: "/team", icon: Users },
    ],
  },
  {
    label: "洞察",
    items: [
      { key: "reports", label: "报表", to: "/reports", icon: TableProperties },
      { key: "templates", label: "模板", to: "/templates", icon: WandSparkles },
    ],
  },
  {
    label: "系统",
    items: [
      { key: "onboarding", label: "开箱向导", to: "/onboarding", icon: ListChecks },
      { key: "settings", label: "设置", to: "/settings", icon: Settings },
    ],
  },
];

export const PRIMARY_NAVIGATION = PRIMARY_NAVIGATION_GROUPS.flatMap((group) => group.items);

export function PrimaryNavigation(props: {
  activeKey: DesktopNavigationKey;
  collapsed: boolean;
  onNavigate?(): void;
}) {
  return (
    <nav
      aria-label="主导航"
      className="primary-navigation"
      data-collapsed={String(props.collapsed)}
    >
      {PRIMARY_NAVIGATION_GROUPS.map((group) => (
        <section className="navigation-group" key={group.label}>
          <span className="navigation-group-label">{group.label}</span>
          {group.items.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                aria-current={props.activeKey === item.key ? "page" : undefined}
                className="primary-navigation-link"
                data-active={props.activeKey === item.key}
                key={item.key}
                onClick={props.onNavigate}
                title={props.collapsed ? item.label : undefined}
                to={item.to}
              >
                <Icon aria-hidden="true" size={17} strokeWidth={1.8} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </section>
      ))}
    </nav>
  );
}
