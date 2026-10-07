import {
  Bell,
  Bot,
  ChevronLeft,
  ChevronRight,
  FileText,
  FolderKanban,
  LayoutDashboard,
  ListChecks,
  ListTodo,
  Settings,
  TableProperties,
  Users,
  WandSparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import { NavLink } from "react-router-dom";

export type DesktopNavigationKey =
  | "dashboard"
  | "tasks"
  | "agents"
  | "notifications"
  | "team"
  | "projects"
  | "documents"
  | "reports"
  | "templates"
  | "onboarding"
  | "settings";

interface NavigationItem {
  key: DesktopNavigationKey;
  label: string;
  to: string;
  icon: LucideIcon;
}

const NAVIGATION_GROUPS: Array<{ label: string; items: NavigationItem[] }> = [
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
      { key: "templates", label: "模板库", to: "/templates", icon: WandSparkles },
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

export function PrimaryNavigation(props: {
  activeKey: DesktopNavigationKey;
  collapsed: boolean;
  onNavigate(): void;
}) {
  return (
    <nav
      aria-label="主导航"
      className="primary-navigation"
      data-collapsed={String(props.collapsed)}
    >
      {NAVIGATION_GROUPS.map((group) => (
        <div className="nav-group" key={group.label}>
          <span className="nav-group-label">{group.label}</span>
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
        </div>
      ))}
    </nav>
  );
}

export function Sidebar(props: {
  activeKey: DesktopNavigationKey;
  collapsed: boolean;
  mobileOpen: boolean;
  onToggleCollapsed(): void;
  onCloseMobile(): void;
  onNavigate(): void;
}) {
  const CollapseIcon = props.collapsed ? ChevronRight : ChevronLeft;
  return (
    <aside className="desktop-sidebar">
      <div className="desktop-brand">
        <img alt="" src="/brand/humanthread-mark.svg" />
        <span className="desktop-brand-copy">
          <strong>HumanThread</strong>
          <small>Desktop 设计预览</small>
        </span>
      </div>
      <PrimaryNavigation
        activeKey={props.activeKey}
        collapsed={props.collapsed}
        onNavigate={props.onNavigate}
      />
      <div className="navigation-footer">
        <button
          aria-label={props.collapsed ? "展开主导航" : "收起主导航"}
          className="ghost-button"
          onClick={props.onToggleCollapsed}
          type="button"
        >
          <CollapseIcon aria-hidden="true" size={15} />
          <span>{props.collapsed ? "展开" : "收起"}</span>
        </button>
        <button
          aria-label="关闭主导航"
          className="ghost-button mobile-nav-close"
          onClick={props.onCloseMobile}
          type="button"
        >
          <X aria-hidden="true" size={15} />
          关闭
        </button>
        <span className="preview-build">设计预览 · 只读</span>
      </div>
    </aside>
  );
}
