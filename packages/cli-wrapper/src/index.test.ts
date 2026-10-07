import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { parseHtRunArgs, reportHtRunResultToWeb, runHtRun } from "./index";

describe("reportHtRunResultToWeb", () => {
  it("sends the configured agent bearer token", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    await reportHtRunResultToWeb({
      taskId: "task_1",
      projectId: "project_1",
      workflowInstanceId: "workflow_1",
      durationSeconds: 12,
      status: "completed",
      exitCode: 0,
      signal: null,
      command: ["codex"],
    }, {
      baseUrl: "http://humanthread.internal",
      apiToken: "token_123",
      fetch,
    });

    expect(fetch).toHaveBeenCalledWith(
      "http://humanthread.internal/api/cli/tasks/task_1/report",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer token_123" }),
      }),
    );
  });

  it("requires an agent API token before sending a result", async () => {
    await expect(reportHtRunResultToWeb({
      taskId: "task_1",
      projectId: "project_1",
      workflowInstanceId: "workflow_1",
      durationSeconds: 12,
      status: "completed",
      exitCode: 0,
      signal: null,
      command: ["codex"],
    }, { baseUrl: "http://humanthread.internal", apiToken: "", fetch: vi.fn() })).rejects.toThrow(
      "HUMANTHREAD_API_TOKEN is required",
    );
  });
});

describe("parseHtRunArgs", () => {
  it("parses task context and command after the separator", () => {
    const result = parseHtRunArgs([
      "--task",
      "workflow_1:confirm_requirement",
      "--project",
      "project_1",
      "--workflow",
      "workflow_1",
      "--",
      "codex",
      "run",
    ]);

    expect(result).toEqual({
      help: false,
      context: {
        taskId: "workflow_1:confirm_requirement",
        projectId: "project_1",
        workflowInstanceId: "workflow_1",
      },
      command: ["codex", "run"],
    });
  });
});

describe("runHtRun", () => {
  it("spawns the command and exposes task context through env vars", async () => {
    const child = new EventEmitter();
    const spawn = vi.fn(() => child);

    const promise = runHtRun(
      {
        taskId: "workflow_1:confirm_requirement",
        projectId: "project_1",
        workflowInstanceId: "workflow_1",
        command: ["codex", "run"],
        cwd: "/tmp/project",
      },
      {
        spawn: spawn as never,
      },
    );

    process.nextTick(() => {
      child.emit("exit", 0, null);
    });

    const result = await promise;

    expect(spawn).toHaveBeenCalledWith(
      "codex",
      ["run"],
      expect.objectContaining({
        cwd: "/tmp/project",
        env: expect.objectContaining({
          HT_TASK_ID: "workflow_1:confirm_requirement",
          HT_PROJECT_ID: "project_1",
          HT_WORKFLOW_INSTANCE_ID: "workflow_1",
        }),
        stdio: "inherit",
      }),
    );
    expect(result).toMatchObject({
      status: "completed",
      exitCode: 0,
      command: ["codex", "run"],
    });
  });

  it("reports the command result after the child process exits", async () => {
    const child = new EventEmitter();
    const spawn = vi.fn(() => child);
    const reportResult = vi.fn().mockResolvedValue(undefined);

    const promise = runHtRun(
      {
        taskId: "workflow_1:confirm_requirement",
        projectId: "project_1",
        workflowInstanceId: "workflow_1",
        command: ["codex", "run"],
        cwd: "/tmp/project",
      },
      {
        spawn: spawn as never,
        reportResult: reportResult as never,
      } as never,
    );

    process.nextTick(() => {
      child.emit("exit", 0, null);
    });

    await promise;

    expect(reportResult).toHaveBeenCalledWith({
      taskId: "workflow_1:confirm_requirement",
      projectId: "project_1",
      workflowInstanceId: "workflow_1",
      durationSeconds: expect.any(Number),
      status: "completed",
      exitCode: 0,
      signal: null,
      command: ["codex", "run"],
      outputSummary: undefined,
    });
  });

  it("captures the last output lines and reports them as outputSummary", async () => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    const spawn = vi.fn(() => child);
    const reportResult = vi.fn().mockResolvedValue(undefined);

    const promise = runHtRun(
      {
        taskId: "workflow_1:run_cli",
        projectId: "project_1",
        workflowInstanceId: "workflow_1",
        command: ["node", "worker.js"],
        cwd: "/tmp/project",
      },
      {
        spawn: spawn as never,
        reportResult: reportResult as never,
      } as never,
    );

    process.nextTick(() => {
      child.stdout.emit("data", Buffer.from("line 1\n"));
      child.stderr.emit("data", Buffer.from("warn line\n"));
      child.stdout.emit("data", Buffer.from("line 2\n"));
      child.emit("exit", 0, null);
    });

    await promise;

    expect(reportResult).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "completed",
        outputSummary: "line 1\nwarn line\nline 2",
      }),
    );
  });

  it("supports overriding the reported status to follow_up", async () => {
    const child = new EventEmitter();
    const spawn = vi.fn(() => child);
    const reportResult = vi.fn().mockResolvedValue(undefined);

    const promise = runHtRun(
      {
        taskId: "workflow_1:run_cli",
        projectId: "project_1",
        workflowInstanceId: "workflow_1",
        command: ["codex", "run"],
        cwd: "/tmp/project",
        reportStatus: "follow_up",
      } as never,
      {
        spawn: spawn as never,
        reportResult: reportResult as never,
      } as never,
    );

    process.nextTick(() => {
      child.emit("exit", 0, null);
    });

    const result = await promise;

    expect(result).toMatchObject({
      status: "completed",
      exitCode: 0,
    });
    expect(reportResult).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "follow_up",
      }),
    );
  });

  it("marks the report as follow_up when no output timeout is reached", async () => {
    vi.useFakeTimers();

    const child = new EventEmitter() as EventEmitter & {
      kill: ReturnType<typeof vi.fn>;
    };
    child.kill = vi.fn();
    const spawn = vi.fn(() => child);
    const reportResult = vi.fn().mockResolvedValue(undefined);

    const promise = runHtRun(
      {
        taskId: "workflow_1:run_cli",
        projectId: "project_1",
        workflowInstanceId: "workflow_1",
        command: ["codex", "run"],
        cwd: "/tmp/project",
        inactivityTimeoutMs: 1000,
      } as never,
      {
        spawn: spawn as never,
        reportResult: reportResult as never,
      } as never,
    );

    await vi.advanceTimersByTimeAsync(1000);

    process.nextTick(() => {
      child.emit("exit", null, "SIGTERM");
    });

    await promise;

    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(reportResult).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "follow_up",
        outputSummary: "CLI 无输出超时，建议人工确认后继续",
      }),
    );

    vi.useRealTimers();
  });
});
