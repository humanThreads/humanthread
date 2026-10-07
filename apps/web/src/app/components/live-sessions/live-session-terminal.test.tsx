// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LiveSessionTerminal } from "./live-session-terminal";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const session = {
  id: "a".repeat(32),
  kind: "worker" as const,
  surface: "web" as const,
  spaceId: "space_company",
  projectId: "project_1",
  taskId: "task_1",
  executionPolicy: "loop" as const,
  target: { type: "worker_pool" as const, workerPoolId: "b".repeat(32), displayName: "ht-agnet" },
  targetDisplayName: "ht-agnet",
  businessRun: { type: "loop_run" as const, id: "loop_1" },
  status: "running" as const,
  controlState: "viewer" as const,
  journal: { status: "ready" as const, retentionDays: 30, firstSequence: 0, lastSequence: 0 },
  createdAt: "2026-09-24T00:00:00.000Z",
  updatedAt: "2026-09-24T00:00:00.000Z",
};

describe("Web live session terminal", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }));
  });
  it("renders the TUI surface and starts read-only", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ok: false, error: "未接通" })));
    render(<LiveSessionTerminal session={session} relayBaseUrl="wss://relay.example" />);

    expect(screen.getByLabelText(`在线终端 ${session.id}`)).toBeTruthy();
    expect(document.querySelector(".tui-terminal-shell")).toBeTruthy();
    expect(document.querySelector(".tui-terminal-canvas")).toBeTruthy();
    expect(document.querySelector(".h-80")).toBeNull();
    expect(screen.getByRole("button", { name: "等待执行端" })).toBeTruthy();
    expect(await screen.findByRole("alert")).toBeTruthy();
  });

  it("distinguishes an unconnected execution target from a terminal ready for input", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      ok: true,
      result: { ticket: { token: "lst1.payload.signature" } },
    })));
    class OpenSocket {
      static OPEN = 1;
      readyState = 1;
      onopen: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      send = vi.fn();
      close = vi.fn();
      constructor() { queueMicrotask(() => this.onopen?.()); }
    }
    vi.stubGlobal("WebSocket", OpenSocket as never);
    Object.assign(globalThis.WebSocket, { OPEN: 1 });

    render(<LiveSessionTerminal session={{ ...session, status: "starting" }} relayBaseUrl="wss://relay.example" />);

    expect(await screen.findByText(/等待执行端接入/u)).toBeTruthy();
    expect(screen.getByText(/Relay/).textContent).toContain("Relay");
    expect(screen.getByRole("button", { name: "等待执行端" })).toBeTruthy();
  });

  it("shows a finished session as history instead of waiting for an executor", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      ok: true,
      result: { ticket: { token: "lst1.payload.signature" } },
    })));
    class OpenSocket {
      static OPEN = 1;
      readyState = 1;
      onopen: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      send = vi.fn();
      close = vi.fn();
      constructor() { queueMicrotask(() => this.onopen?.()); }
    }
    vi.stubGlobal("WebSocket", OpenSocket as never);
    Object.assign(globalThis.WebSocket, { OPEN: 1 });

    render(<LiveSessionTerminal session={{ ...session, status: "running", history: true }} relayBaseUrl="wss://relay.example" />);

    // A finished execution never re-attaches, so the waiting overlay and the
    // control claim must both stay away.
    await screen.findByRole("button", { name: "历史日志" });
    expect(screen.queryByText(/等待执行端接入/u)).toBeNull();
    expect(screen.getByText(/执行端 已结束/u)).toBeTruthy();
    expect(screen.getAllByText("历史").length).toBeGreaterThan(0);
  });

  it("enables control when the relay reports an online execution target", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      ok: true,
      result: { ticket: { token: "lst1.payload.signature" } },
    })));
    class OpenSocket {
      static OPEN = 1;
      readyState = 1;
      onopen: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      send = vi.fn();
      close = vi.fn();
      constructor() {
        queueMicrotask(() => {
          this.onopen?.();
          this.onmessage?.({ data: JSON.stringify({ type: "server.hello", targetOnline: true }) });
        });
      }
    }
    vi.stubGlobal("WebSocket", OpenSocket as never);
    Object.assign(globalThis.WebSocket, { OPEN: 1 });

    render(<LiveSessionTerminal session={{ ...session, status: "running" }} relayBaseUrl="wss://relay.example" />);

    expect(await screen.findByRole("button", { name: "接管控制" })).toBeTruthy();
  });

  it("claims control automatically once the execution target is online", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      ok: true,
      result: { ticket: { token: "lst1.payload.signature" } },
    })));
    const sent: string[] = [];
    class OpenSocket {
      static OPEN = 1;
      readyState = 1;
      onopen: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      send = vi.fn((payload: string) => { sent.push(payload); });
      close = vi.fn();
      constructor() {
        queueMicrotask(() => {
          this.onopen?.();
          this.onmessage?.({ data: JSON.stringify({ type: "server.hello", targetOnline: true }) });
        });
      }
    }
    vi.stubGlobal("WebSocket", OpenSocket as never);
    Object.assign(globalThis.WebSocket, { OPEN: 1 });

    render(<LiveSessionTerminal session={{ ...session, status: "running" }} relayBaseUrl="wss://relay.example" />);

    // Typing at the cursor must work without first discovering the toolbar
    // button; the terminal claims the lease as soon as a target can receive it.
    await vi.waitFor(() => {
      expect(sent).toContain(JSON.stringify({ type: "control.claim" }));
    });
  });
});
