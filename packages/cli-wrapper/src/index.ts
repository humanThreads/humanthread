import { spawn, type ChildProcess } from "node:child_process";

export interface HtRunContext {
  taskId: string;
  projectId: string;
  workflowInstanceId: string;
  cwd: string;
  command: string[];
  reportStatus?: "completed" | "interrupted" | "follow_up" | "blocked";
  inactivityTimeoutMs?: number;
}

export interface HtRunResult {
  status: "completed" | "interrupted";
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  command: string[];
}

export interface ReportHtRunResultInput {
  taskId: string;
  projectId: string;
  workflowInstanceId: string;
  durationSeconds: number;
  outputSummary?: string | undefined;
  status: "completed" | "interrupted" | "follow_up" | "blocked";
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  command: string[];
}

export interface ParsedHtRunArgs {
  help: boolean;
  context: Pick<HtRunContext, "taskId" | "projectId" | "workflowInstanceId">;
  command: string[];
}

export interface SpawnLike {
  spawn: typeof spawn;
}

export interface ReportResultLike {
  reportResult(input: ReportHtRunResultInput): Promise<void>;
}

export async function reportHtRunResultToWeb(
  input: ReportHtRunResultInput,
  dependencies: {
    baseUrl?: string;
    apiToken?: string;
    fetch?: typeof fetch;
  } = {},
): Promise<void> {
  const baseUrl = dependencies.baseUrl ?? process.env.HT_API_BASE_URL ?? "http://127.0.0.1:3000";
  const apiToken = dependencies.apiToken ?? process.env.HUMANTHREAD_API_TOKEN ?? "";
  if (!apiToken.trim()) throw new Error("HUMANTHREAD_API_TOKEN is required to report ht-run results");
  const request = dependencies.fetch ?? fetch;
  const response = await request(
    `${baseUrl}/api/cli/tasks/${encodeURIComponent(input.taskId)}/report`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiToken.trim()}`,
      },
      body: JSON.stringify({
        status: input.status,
        exitCode: input.exitCode,
        durationSeconds: input.durationSeconds,
        ...(input.outputSummary !== undefined ? { outputSummary: input.outputSummary } : {}),
        payload: {
          command: input.command,
          workflowInstanceId: input.workflowInstanceId,
          projectId: input.projectId,
        },
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to report ht-run result: ${response.status}`);
  }
}

export function parseHtRunArgs(argv: string[]): ParsedHtRunArgs {
  const context: ParsedHtRunArgs["context"] = {
    taskId: "",
    projectId: "",
    workflowInstanceId: "",
  };
  const commandSeparator = argv.indexOf("--");
  const optionTokens = commandSeparator >= 0 ? argv.slice(0, commandSeparator) : argv;
  const command = commandSeparator >= 0 ? argv.slice(commandSeparator + 1) : [];

  for (let index = 0; index < optionTokens.length; index += 2) {
    const flag = optionTokens[index];
    const value = optionTokens[index + 1];

    if (!flag || !value) {
      continue;
    }

    if (flag === "--task") {
      context.taskId = value;
    }

    if (flag === "--project") {
      context.projectId = value;
    }

    if (flag === "--workflow") {
      context.workflowInstanceId = value;
    }
  }

  return {
    help: argv.includes("--help"),
    context,
    command,
  };
}

function waitForChildProcessExit(
  childProcess: ChildProcess,
): Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve) => {
    childProcess.once("exit", (exitCode: number | null, signal: NodeJS.Signals | null) => {
      resolve({
        exitCode,
        signal,
      });
    });
  });
}

function normalizeOutputChunk(chunk: unknown): string {
  if (typeof chunk === "string") {
    return chunk;
  }

  if (Buffer.isBuffer(chunk)) {
    return chunk.toString("utf8");
  }

  return String(chunk);
}

function trimTrailingNewline(value: string): string {
  return value.replace(/\n+$/u, "");
}

function createOutputCollector(maxLines = 10) {
  const lines: string[] = [];
  let pending = "";

  function appendChunk(chunk: unknown) {
    pending += normalizeOutputChunk(chunk);
    const parts = pending.split("\n");
    pending = parts.pop() ?? "";

    for (const part of parts) {
      lines.push(part);
    }

    if (lines.length > maxLines) {
      lines.splice(0, lines.length - maxLines);
    }
  }

  function getSummary(): string | undefined {
    const summaryLines = [...lines];

    if (pending.length > 0) {
      summaryLines.push(trimTrailingNewline(pending));
    }

    const summary = summaryLines
      .map((line) => trimTrailingNewline(line))
      .filter((line) => line.length > 0)
      .slice(-maxLines)
      .join("\n");

    return summary.length > 0 ? summary : undefined;
  }

  return {
    appendChunk,
    getSummary,
  };
}

function scheduleInactivityTimer(input: {
  childProcess: ChildProcess;
  timeoutMs?: number;
  onTimeout: () => void;
}) {
  if (!input.timeoutMs || input.timeoutMs <= 0) {
    return {
      bump: () => {},
      clear: () => {},
    };
  }

  let timer = setTimeout(() => {
    input.onTimeout();
  }, input.timeoutMs);

  function bump() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      input.onTimeout();
    }, input.timeoutMs);
  }

  function clear() {
    clearTimeout(timer);
  }

  return {
    bump,
    clear,
  };
}

export async function runHtRun(
  context: HtRunContext,
  dependencies: SpawnLike & Partial<ReportResultLike> = {
    spawn,
    reportResult: reportHtRunResultToWeb,
  },
): Promise<HtRunResult> {
  if (context.command.length === 0) {
    throw new Error("Missing command after --");
  }

  const [command, ...args] = context.command;

  if (!command) {
    throw new Error("Missing command after --");
  }

  const startedAt = Date.now();
  const childProcess = dependencies.spawn(command, args, {
    cwd: context.cwd,
    env: {
      ...process.env,
      HT_TASK_ID: context.taskId,
      HT_PROJECT_ID: context.projectId,
      HT_WORKFLOW_INSTANCE_ID: context.workflowInstanceId,
    },
    stdio: "inherit",
  });
  const outputCollector = createOutputCollector();
  let timeoutForcedFollowUp = false;
  const inactivityTimer = scheduleInactivityTimer({
    childProcess,
    ...(context.inactivityTimeoutMs !== undefined
      ? { timeoutMs: context.inactivityTimeoutMs }
      : {}),
    onTimeout: () => {
      timeoutForcedFollowUp = true;
      childProcess.kill?.("SIGTERM");
    },
  });

  childProcess.stdout?.on("data", (chunk) => {
    outputCollector.appendChunk(chunk);
    inactivityTimer.bump();
  });
  childProcess.stderr?.on("data", (chunk) => {
    outputCollector.appendChunk(chunk);
    inactivityTimer.bump();
  });

  const result = await waitForChildProcessExit(childProcess);
  inactivityTimer.clear();
  const durationSeconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
  const inferredStatus =
    result.signal ? "interrupted" : result.exitCode === 0 ? "completed" : "interrupted";
  const reportedStatus = timeoutForcedFollowUp
    ? "follow_up"
    : (context.reportStatus ?? inferredStatus);
  const outputSummary = timeoutForcedFollowUp
    ? "CLI 无输出超时，建议人工确认后继续"
    : outputCollector.getSummary();
  try {
    await dependencies.reportResult?.({
      taskId: context.taskId,
      projectId: context.projectId,
      workflowInstanceId: context.workflowInstanceId,
      durationSeconds,
      status: reportedStatus,
      exitCode: result.exitCode,
      signal: result.signal,
      command: context.command,
      ...(outputSummary !== undefined ? { outputSummary } : {}),
    });
  } catch (error) {
    console.warn(
      error instanceof Error ? error.message : "Failed to report ht-run result",
    );
  }

  if (result.signal) {
    return {
      status: "interrupted",
      exitCode: result.exitCode,
      signal: result.signal,
      command: context.command,
    };
  }

  return {
    status: result.exitCode === 0 ? "completed" : "interrupted",
    exitCode: result.exitCode,
    signal: result.signal,
    command: context.command,
  };
}
