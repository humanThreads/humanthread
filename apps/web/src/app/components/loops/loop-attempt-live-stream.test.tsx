// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LoopAttemptLiveStream } from "./loop-attempt-live-stream";

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    loadAddon() {}
    open() {}
    write() {}
    dispose() {}
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class { fit() {} },
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const attempt = {
  attemptId: "loop_attempt:abc123",
  attempt: 1,
  status: "running",
  executorType: "local",
  startedAt: "2026-09-30T00:00:00.000Z",
  finishedAt: null,
  result: null,
  error: null,
  executionPhase: {
    phase: "git.fetch",
    status: "running" as const,
    startedAt: "2026-09-30T00:00:01.000Z",
    finishedAt: null,
    code: null,
    summary: "正在同步远端引用",
    updatedAt: "2026-09-30T00:00:01.000Z",
  },
};

describe("LoopAttemptLiveStream", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, result: { ticket: { token: "lst1.viewer.token" } } }),
    }));
  });

  function stubLiveStreamFetch(sessionId = "a".repeat(32)) {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/live-stream")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            ok: true,
            result: {
              mode: "phase_and_tui",
              session: { id: sessionId },
              phase: {
                name: "git.fetch",
                status: "running",
                startedAt: "2026-09-30T00:00:01.000Z",
                finishedAt: null,
                code: null,
                summary: "正在同步远端引用",
              },
            },
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ ok: true, result: { ticket: { token: "lst1.viewer.token" } } }),
      });
    }));
  }

  it("renders the attempt phase without offering input or control controls", () => {
    render(<LoopAttemptLiveStream loopRunId="loop_run_1" attempt={attempt} />);

    expect(screen.getByText("git.fetch")).toBeTruthy();
    expect(screen.getByText("正在同步远端引用")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /接管控制/u })).toBeNull();
    expect(screen.queryByRole("button", { name: /释放控制/u })).toBeNull();
    expect(screen.queryByRole("button", { name: /重新连接/u })).toBeNull();
  });

  it("requests a viewer ticket and opens the read-only relay scope", async () => {
    stubLiveStreamFetch();
    const sockets: Array<{ url: string; sent: string[] }> = [];
    class FakeWebSocket {
      static OPEN = 1;
      readyState = 1;
      binaryType = "";
      url: string;
      sent: string[] = [];
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: unknown }) => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(url: URL | string) {
        this.url = String(url);
        sockets.push(this);
      }
      send(value: string) { this.sent.push(value); }
      close() { this.readyState = 3; }
    }
    vi.stubGlobal("WebSocket", FakeWebSocket);

    render(<LoopAttemptLiveStream loopRunId="loop_run_1" attempt={attempt} />);

    await waitFor(() => expect(sockets).toHaveLength(1));
    // The live-stream route resolves the attempt by primary key. Requesting it
    // by the human-facing attempt number returned live_stream_not_available and
    // left the realtime panel empty even though the session existed.
    expect(fetch).toHaveBeenCalledWith(
      `/api/loop-runs/loop_run_1/attempts/${encodeURIComponent("loop_attempt:abc123")}/live-stream`,
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetch).toHaveBeenCalledWith(
      `/api/live-sessions/${"a".repeat(32)}/ticket`,
      expect.objectContaining({ method: "POST" }),
    );
    const url = new URL(sockets[0]!.url);
    expect(url.searchParams.get("scope")).toBe("viewer");
    expect(url.searchParams.get("ticket")).toBe("lst1.viewer.token");
  });

  it("renders explicit copy when the attempt has no phase record", () => {
    render(<LoopAttemptLiveStream loopRunId="loop_run_1" attempt={{ ...attempt, executionPhase: null }} />);

    expect(screen.getByText(/无阶段记录/u)).toBeTruthy();
  });
});
