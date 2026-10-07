import { WorkbenchApiError } from "@humanthread/workbench-client";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AsyncState } from "./primitives";

function renderError(error: WorkbenchApiError) {
  return render(
    <AsyncState error={error} label="加载中" status="error">
      <div />
    </AsyncState>,
  );
}

describe("AsyncState", () => {
  it("distinguishes expired sessions, forbidden access, offline and server failures", () => {
    const { rerender, unmount } = renderError(new WorkbenchApiError({
      kind: "unauthenticated",
      code: "authentication_required",
      message: "Desktop session has expired",
      retryable: false,
    }));
    expect(screen.getByText("会话已过期")).toBeInTheDocument();

    rerender(<AsyncState error={new WorkbenchApiError({
      kind: "forbidden",
      code: "authorization_denied",
      message: "Space access denied",
      retryable: false,
    })} label="加载中" status="error"><div /></AsyncState>);
    expect(screen.getByText("没有访问该空间的权限")).toBeInTheDocument();

    rerender(<AsyncState error={new WorkbenchApiError({
      kind: "offline",
      code: "network_error",
      message: "Failed to fetch",
      retryable: true,
    })} label="加载中" status="error"><div /></AsyncState>);
    expect(screen.getByText("网络不可用，已保留最近一次成功数据")).toBeInTheDocument();

    rerender(<AsyncState error={new WorkbenchApiError({
      kind: "server",
      code: "internal_error",
      message: "Server failed",
      retryable: true,
    })} label="加载中" status="error"><div /></AsyncState>);
    expect(screen.getByText("服务暂时不可用")).toBeInTheDocument();
    unmount();
  });

  it("teaches the empty state instead of showing a blank panel", () => {
    render(<AsyncState empty emptyDescription="调整筛选条件后重试" label="加载中" status="success"><div /></AsyncState>);
    expect(screen.getByText("暂无数据")).toBeInTheDocument();
    expect(screen.getByText("调整筛选条件后重试")).toBeInTheDocument();
  });
});
