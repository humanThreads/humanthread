import { describe, expect, it, vi } from "vitest";

import {
  collectWorkerReviewArtifacts,
  createWorkerRejectionGuard,
  createWorkerService,
  workerRegistrationCapabilities,
  workerRuntimeMetadata,
} from "./worker-service";
import { createWorkerCodexTuiHost } from "./live-session-tui";
import { modelProviderArguments } from "./app-server-client";

describe("resident Linux Worker service", () => {
  it("subscribes the TUI host to app-server output deltas", async () => {
    const listeners = new Set<(message: { method: string; params: unknown }) => void>();
    const sessionId = "d".repeat(32);
    const host = createWorkerCodexTuiHost({
      client: {
        endpoint: () => "ws://127.0.0.1:1234",
        request: vi.fn(async (method: string) => method === "thread/start" ? { thread: { id: "thread_1" } } : {}),
        subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
      },
      codexHome: "/state/codex/x",
    });

    const onOutput = vi.fn();
    await host.spawn({
      handle: `worker-tui:${sessionId}`,
      threadId: "thread_1",
      cwd: "/state/direct-sessions/x",
      onOutput,
      onExit: vi.fn(),
    });

    // PTY bytes only arrive as process/outputDelta notifications. Without this
    // subscription the Relay reports an online target while the terminal stays
    // permanently blank.
    expect(listeners.size).toBeGreaterThan(0);
    for (const listener of listeners) {
      listener({
        method: "process/outputDelta",
        params: { processHandle: `worker-tui:${sessionId}`, deltaBase64: Buffer.from("tui output").toString("base64") },
      });
    }
    await vi.waitFor(() => expect(onOutput).toHaveBeenCalledOnce());
    expect(Buffer.from(onOutput.mock.calls[0]![0]).toString()).toBe("tui output");
  });

  it("drains the current runtime and stops polling for new assignments", async () => {
    const runtime = {
      tick: vi.fn().mockResolvedValue(undefined),
      drain: vi.fn().mockResolvedValue(undefined),
      state: vi.fn().mockReturnValue("idle"),
    };
    const service = createWorkerService({
      platformUrl: "http://localhost:3000",
      poolToken: "htwp_bootstrap_value",
      stateDirectory: "/state",
      pollIntervalMs: 1,
    }, { createRuntime: () => runtime, log: vi.fn() });

    service.start();
    await vi.waitFor(() => expect(runtime.tick).toHaveBeenCalled());
    await service.stop();
    const ticksAtStop = runtime.tick.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(runtime.drain).toHaveBeenCalledOnce();
    expect(runtime.tick).toHaveBeenCalledTimes(ticksAtStop);
  });

  it("serves secret-free liveness and readiness from the resident runtime state", async () => {
    const runtime = {
      tick: vi.fn().mockResolvedValue(undefined),
      drain: vi.fn().mockResolvedValue(undefined),
      state: vi.fn().mockReturnValue("idle"),
    };
    const service = createWorkerService({
      platformUrl: "http://localhost:3000",
      poolToken: "htwp_bootstrap_value",
      stateDirectory: "/state",
      healthPort: 0,
    }, { createRuntime: () => runtime, log: vi.fn() });

    await service.start();
    const address = service.healthAddress();
    expect(address).not.toBeNull();
    const liveness = await fetch(`http://127.0.0.1:${address!.port}/healthz`);
    const readiness = await fetch(`http://127.0.0.1:${address!.port}/readyz`);

    await expect(liveness.json()).resolves.toEqual({ status: "ok" });
    await expect(readiness.json()).resolves.toEqual({ ready: true, state: "idle" });
    expect(readiness.status).toBe(200);
    expect(JSON.stringify(await (await fetch(`http://127.0.0.1:${address!.port}/readyz`)).json())).not.toContain("htwp_bootstrap_value");
    await service.stop();
  });

  it("keeps liveness available while reporting degraded and offline Workers as unready", async () => {
    const runtime = {
      tick: vi.fn().mockResolvedValue(undefined),
      drain: vi.fn().mockResolvedValue(undefined),
      state: vi.fn().mockReturnValue("degraded"),
    };
    const service = createWorkerService({
      platformUrl: "http://localhost:3000",
      poolToken: "htwp_bootstrap_value",
      stateDirectory: "/state",
      healthPort: 0,
    }, { createRuntime: () => runtime, log: vi.fn() });

    await service.start();
    const port = service.healthAddress()!.port;
    const liveness = await fetch(`http://127.0.0.1:${port}/healthz`);
    const readiness = await fetch(`http://127.0.0.1:${port}/readyz`);

    expect(liveness.status).toBe(200);
    expect(readiness.status).toBe(503);
    await expect(readiness.json()).resolves.toEqual({ ready: false, state: "degraded" });
    await service.stop();
  });

  it("keeps the Worker unready while registration is still in progress", async () => {
    const runtime = {
      tick: vi.fn().mockResolvedValue(undefined),
      drain: vi.fn().mockResolvedValue(undefined),
      state: vi.fn().mockReturnValue("registering"),
    };
    const service = createWorkerService({
      platformUrl: "http://localhost:3000",
      poolToken: "htwp_bootstrap_value",
      stateDirectory: "/state",
      healthPort: 0,
    }, { createRuntime: () => runtime, log: vi.fn() });

    await service.start();
    const readiness = await fetch(`http://127.0.0.1:${service.healthAddress()!.port}/readyz`);

    expect(readiness.status).toBe(503);
    await expect(readiness.json()).resolves.toEqual({ ready: false, state: "registering" });
    await service.stop();
  });

  it("emits secret-free structured lifecycle logs", async () => {
    const logs: Array<Record<string, unknown>> = [];
    const runtime = {
      tick: vi.fn().mockResolvedValue(undefined),
      drain: vi.fn().mockResolvedValue(undefined),
      state: vi.fn().mockReturnValue("idle"),
    };
    const service = createWorkerService({
      platformUrl: "http://localhost:3000",
      poolToken: "htwp_bootstrap_value",
      stateDirectory: "/state",
      healthPort: 0,
    }, { createRuntime: () => runtime, log: (entry) => logs.push(entry) });

    await service.start();
    await vi.waitFor(() => expect(logs).toContainEqual(expect.objectContaining({ event: "worker.service.started", state: "idle" })));
    await service.stop();

    expect(logs).toContainEqual(expect.objectContaining({ event: "worker.service.stopped", state: "idle" }));
    expect(JSON.stringify(logs)).not.toContain("htwp_bootstrap_value");
    expect(JSON.stringify(logs)).not.toContain("http://localhost:3000");
  });

  it("registers the declared environment configuration version as non-sensitive Worker metadata", () => {
    expect(workerRegistrationCapabilities({
      HT_ENVIRONMENT_CONFIG_VERSION: "7",
      HT_WORKER_CAPABILITIES: '{"workspace":true}',
    })).toEqual({ workspace: true, humanthreadEnvironmentConfigurationVersion: 7 });
  });

  it("marks Kubernetes registrations with the task group used by the replica set", () => {
    expect(workerRuntimeMetadata({
      HT_WORKER_RUNTIME: "kubernetes",
      HT_WORKER_POOL_NAME: "ht-agnet",
    })).toEqual({ runtime: "kubernetes", taskGroupName: "ht-agnet" });
  });
});

describe("worker process rejection guard", () => {
  it("records an escaped rejection as structured evidence instead of crashing", () => {
    const listeners = new Map<string, (reason: unknown) => void>();
    const target = {
      on(event: string, listener: (reason: unknown) => void) { listeners.set(event, listener); return target; },
      off(event: string) { listeners.delete(event); return target; },
    };
    const log = vi.fn();
    const dispose = createWorkerRejectionGuard({
      target,
      log,
      now: () => new Date("2026-09-25T00:00:00.000Z"),
    });

    const escaped = Object.assign(new Error("Relay connection is offline"), { code: "internal_connector_offline" });
    expect(() => listeners.get("unhandledRejection")?.(escaped)).not.toThrow();
    expect(log).toHaveBeenCalledWith(expect.objectContaining({
      event: "worker.unhandled_rejection",
      state: "degraded",
      timestamp: "2026-09-25T00:00:00.000Z",
      code: "internal_connector_offline",
      message: "Relay connection is offline",
    }));

    dispose();
    expect(listeners.has("unhandledRejection")).toBe(false);
  });

  it("redacts non-error rejection values", () => {
    const listeners = new Map<string, (reason: unknown) => void>();
    const target = {
      on(event: string, listener: (reason: unknown) => void) { listeners.set(event, listener); return target; },
      off(event: string) { listeners.delete(event); return target; },
    };
    const log = vi.fn();
    createWorkerRejectionGuard({ target, log });

    listeners.get("unhandledRejection")?.("htwp_secret_token_value");

    expect(log).toHaveBeenCalledWith(expect.objectContaining({
      code: "unhandled_rejection",
      message: "Worker encountered an unexpected rejection",
    }));
  });
});

describe("Worker TUI provider configuration", () => {
  it("passes the worker model provider to the TUI so it never shows the ChatGPT login screen", () => {
    const args = modelProviderArguments("https://usapi.mircosoft.cn");

    // The TUI is a second `codex` process: without the same provider config it
    // ignores the app-server endpoint's provider and renders a login prompt.
    expect(args).toContain('model_provider="humanthread_linux_worker"');
    expect(args.join(" ")).toContain("usapi.mircosoft.cn");
    expect(args).toEqual(expect.arrayContaining(["--config", 'model_reasoning_summary="none"']));
    // Credentials stay with the app-server; the TUI only needs the endpoint.
    expect(args.join(" ")).not.toContain("sk-");
  });
});

describe("Worker review Artifact collection", () => {
  it("collects only review HTML pages from generated/reviews", async () => {
    const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const root = await mkdtemp(join(tmpdir(), "ht-worker-reviews-"));
    try {
      await mkdir(join(root, "generated/reviews/nested"), { recursive: true });
      await mkdir(join(root, "generated/reports"), { recursive: true });
      await writeFile(join(root, "generated/reviews/chapter-plan.html"), "<html>plan</html>");
      await writeFile(join(root, "generated/reviews/nested/audit.htm"), "<html>audit</html>");
      await writeFile(join(root, "generated/reviews/notes.txt"), "not html");
      await writeFile(join(root, "generated/reviews/empty.html"), "");
      await writeFile(join(root, "generated/reports/other.html"), "<html>other</html>");

      await expect(collectWorkerReviewArtifacts(root)).resolves.toEqual([
        { relativePath: "generated/reviews/chapter-plan.html", content: "<html>plan</html>" },
        { relativePath: "generated/reviews/nested/audit.htm", content: "<html>audit</html>" },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns no Artifacts when the workspace has no review directory", async () => {
    await expect(collectWorkerReviewArtifacts("/nonexistent-humanthread-workspace")).resolves.toEqual([]);
  });
});
