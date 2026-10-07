import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { CodexTuiClient, CodexTuiSession } from "../../lib/codex-tui-client";
import { LocalTerminalPage } from "./local-terminal-page";

const sessions: CodexTuiSession[] = [
  {
    sessionId: "session_running",
    runId: "run_1",
    taskId: "task_1",
    projectId: "project_1",
    nodeKey: "develop",
    processKey: "codex-daemon:test",
    threadId: "thread_1",
    cwd: "/workspace",
    model: "model_1",
    status: "running",
    controlState: "viewer",
    controllerWindowId: null,
    attachedCount: 0,
    lastActivityAtMs: 20,
    bufferBytes: 1,
    generation: 1,
    attached: false,
  },
  {
    sessionId: "session_detached",
    runId: "run_2",
    taskId: "task_2",
    projectId: "project_2",
    nodeKey: "review",
    processKey: "codex-daemon:test",
    threadId: "thread_2",
    cwd: "/workspace-two",
    model: null,
    status: "detached",
    controlState: "detached",
    controllerWindowId: null,
    attachedCount: 0,
    lastActivityAtMs: 10,
    bufferBytes: 0,
    generation: 1,
    attached: false,
  },
];

function createClient(): CodexTuiClient {
  return {
    register: vi.fn(async () => undefined),
    start: vi.fn(async () => sessions[0]!),
    unregister: vi.fn(async () => undefined),
    list: vi.fn(async () => sessions),
    spawn: vi.fn(async () => ({ session: sessions[0]!, replayBase64: "" })),
    attach: vi.fn(async () => ({ session: sessions[0]!, replayBase64: "" })),
    reattach: vi.fn(async () => sessions[0]!),
    detach: vi.fn(async () => sessions[0]!),
    write: vi.fn(async () => undefined),
    resize: vi.fn(async () => undefined),
    acquire: vi.fn(async () => sessions[0]!),
    release: vi.fn(async () => sessions[0]!),
    close: vi.fn(async () => undefined),
    subscribeOutput: vi.fn(async () => () => undefined),
    subscribeState: vi.fn(async () => () => undefined),
  };
}

describe("LocalTerminalPage", () => {
  it("lists only local sessions and exposes no remote-device control", () => {
    render(<LocalTerminalPage
      client={createClient()}
      sessions={sessions}
      selectedSessionId={null}
      onRefresh={vi.fn()}
      onOpen={vi.fn()}
      onClose={vi.fn()}
    />);

    expect(screen.getByRole("region", { name: "本机 Codex 终端" })).toBeInTheDocument();
    expect(screen.getByText("develop")).toBeInTheDocument();
    expect(screen.getByText("review")).toBeInTheDocument();
    expect(screen.queryByText(/其他设备/u)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/远程/u)).not.toBeInTheDocument();
  });

  it("filters by status and opens the selected local session", async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<LocalTerminalPage
      client={createClient()}
      sessions={sessions}
      selectedSessionId={null}
      onRefresh={vi.fn()}
      onOpen={onOpen}
      onClose={vi.fn()}
    />);

    await user.selectOptions(screen.getByLabelText("终端状态"), "detached");
    expect(screen.queryByText("develop")).not.toBeInTheDocument();
    expect(screen.getByText("review")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "打开 review" }));
    expect(onOpen).toHaveBeenCalledWith("session_detached");
  });

  it("offers reattach for detached sessions and close for each local session", async () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    const client = createClient();
    const user = userEvent.setup();
    render(<LocalTerminalPage
      client={client}
      sessions={sessions}
      selectedSessionId={null}
      onRefresh={vi.fn()}
      onOpen={onOpen}
      onClose={onClose}
    />);

    await user.click(screen.getByRole("button", { name: "重新附着 review" }));
    expect(onOpen).toHaveBeenCalledWith("session_detached");
    await user.click(screen.getByRole("button", { name: "关闭 develop" }));
    expect(onClose).toHaveBeenCalledWith("session_running");
  });
});
