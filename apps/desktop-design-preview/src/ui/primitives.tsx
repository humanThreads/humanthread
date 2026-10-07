import { WorkbenchApiError } from "@humanthread/workbench-client";
import { AlertTriangle, Inbox, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

export function StatusPill(props: {
  children: ReactNode;
  tone?: "neutral" | "brand" | "success" | "info" | "warning" | "danger";
}) {
  return (
    <span className="status-pill" data-tone={props.tone ?? "neutral"}>
      {props.children}
    </span>
  );
}

export function PageHeader(props: {
  title: string;
  description?: string;
  actions?: ReactNode;
  showTitle?: boolean;
}) {
  return (
    <header className="page-header">
      <div className="page-header-copy">
        <h1 className={props.showTitle ? undefined : "sr-only"}>{props.title}</h1>
        {props.description ? <p>{props.description}</p> : null}
      </div>
      {props.actions ? <div className="page-header-actions">{props.actions}</div> : null}
    </header>
  );
}

export function SurfacePanel(props: {
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <section
      aria-label={props.label}
      className={`surface-panel${props.className ? ` ${props.className}` : ""}`}
    >
      {props.children}
    </section>
  );
}

export function SurfaceHeader(props: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="surface-header">
      <div>
        <h2>{props.title}</h2>
        {props.description ? <p className="muted">{props.description}</p> : null}
      </div>
      {props.actions ? <div className="toolbar-actions">{props.actions}</div> : null}
    </header>
  );
}

export function AsyncState(props: {
  status: "pending" | "error" | "success";
  label: string;
  error?: unknown;
  empty?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  onRetry?: () => void;
  children: ReactNode;
}) {
  if (props.status === "pending") {
    return (
      <div aria-label={props.label} className="async-loading" role="status">
        <span className="skeleton-line" />
        <span className="skeleton-line short" />
      </div>
    );
  }
  if (props.status === "error") {
    const error = asyncErrorCopy(props.error);
    return (
      <div className="async-error" role="alert">
        <AlertTriangle aria-hidden="true" size={20} />
        <strong>{error.title}</strong>
        <p>{error.description}</p>
        {props.onRetry ? (
          <button className="secondary-button" onClick={props.onRetry} type="button">
            <RefreshCw aria-hidden="true" size={14} />
            重新加载
          </button>
        ) : null}
      </div>
    );
  }
  if (props.empty) {
    return (
      <div className="empty-state">
        <Inbox aria-hidden="true" size={22} />
        <strong>{props.emptyTitle ?? "暂无数据"}</strong>
        <p>{props.emptyDescription ?? "当前筛选条件下没有可展示内容。"}</p>
      </div>
    );
  }
  return props.children;
}

function asyncErrorCopy(error: unknown): { title: string; description: string } {
  if (error instanceof WorkbenchApiError) {
    if (error.kind === "unauthenticated") {
      return { title: "会话已过期", description: "重新登录后可继续读取工作台数据。" };
    }
    if (error.kind === "forbidden") {
      return { title: "没有访问该空间的权限", description: "请切换空间或联系空间管理员申请权限。" };
    }
    if (error.kind === "offline") {
      return { title: "网络不可用，已保留最近一次成功数据", description: "网络恢复后可重新加载。" };
    }
    if (error.kind === "server") {
      return { title: "服务暂时不可用", description: "官网返回了服务端错误，请稍后重试。" };
    }
    return { title: error.message, description: "当前请求未完成，请检查后重试。" };
  }
  return {
    title: error instanceof Error ? error.message : "当前信息暂时无法加载",
    description: "当前请求未完成，请稍后重试。",
  };
}

export function Toolbar(props: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="toolbar">
      <div className="toolbar-group">{props.children}</div>
      {props.actions ? <div className="toolbar-actions">{props.actions}</div> : null}
    </div>
  );
}
