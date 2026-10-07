import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

import {
  buildCodexCommand,
  buildCodexCommandWithOverrides,
  resolveCodexExecutable,
  validateCodexArgs,
  validateCodexRuntimeBinding,
  validateEnvironmentOverrides,
} from "./agent-runtime";
import {
  buildInterruptCommandSpec,
  buildManagedCommand,
  buildRestoreSessionCommand,
  buildTerminalLauncherCommand,
  desktopPlatformName,
  interruptProcess,
  validateEnvironmentRefs,
} from "./core";
import { prepareIsolatedCodexHome, readAgentCredential, type CredentialContext } from "./local-model";
import { removeIndependentCredentialEnvironmentRefs } from "./core";
import { resolveWorkspacePathImpl } from "./workspace";

export type ManagedCommandKind =
  | { kind: "project"; externalSession: boolean }
  | { kind: "codex" };

export interface DesktopQuitState {
  managedRunning: boolean;
  externalSession: boolean;
}

export interface ProcessHost {
  send(event: string, payload: unknown): void;
}

export class ManagedCommandRegistry {
  private readonly commands = new Map<number, ManagedCommandKind>();

  insertProject(processId: number, externalSession: boolean): void {
    this.commands.set(processId, { kind: "project", externalSession });
  }

  insertCodex(processId: number): void {
    this.commands.set(processId, { kind: "codex" });
  }

  containsCodex(processId: number): boolean {
    return this.commands.get(processId)?.kind === "codex";
  }

  remove(processId: number): void {
    this.commands.delete(processId);
  }

  quitState(): { managedRunning: boolean; externalSession: boolean } {
    return {
      managedRunning: this.commands.size > 0,
      externalSession: [...this.commands.values()].some(
        (entry) => entry.kind === "project" && entry.externalSession,
      ),
    };
  }

  processIds(): number[] {
    return [...this.commands.keys()];
  }

  interruptAll(): void {
    for (const processId of this.processIds()) {
      if (!buildInterruptCommandSpec(desktopPlatformName(), processId)) {
        throw new Error("Managed command interruption is unavailable on this platform");
      }
      interruptProcess(processId);
    }
  }
}

export interface CodexProcessOutput {
  processKey: string;
  processId: number;
  stream: "stdout" | "stderr";
  chunk: string;
}

export interface CodexProcessExit {
  processKey: string;
  processId: number;
  code: number | null;
  signal: string | null;
}

export interface CommandExitedEvent {
  taskId: string;
  projectId: string;
  workflowInstanceId: string;
  cwd: string;
  command: string;
  processId: number;
  shell: string;
  status: "completed" | "interrupted";
  exitCode: number | null;
  signal: number | null;
  error?: string;
  sessionName?: string;
  sessionType?: string;
}

function validateProcessKey(value: string): void {
  if (
    value.length === 0 ||
    value.length > 128 ||
    !/^[A-Za-z0-9_:.-]+$/u.test(value)
  ) {
    throw new Error("Codex process key is invalid");
  }
}

export function startCodexProcess(input: {
  host: ProcessHost;
  registry: ManagedCommandRegistry;
  processKey: string;
  cwd: string;
  executable: string;
  args: string[];
  environmentRefs: string[];
  environmentOverrides?: Record<string, string>;
  credentialContext?: CredentialContext;
}): number {
  validateProcessKey(input.processKey);
  validateEnvironmentRefs(input.environmentRefs);
  let environmentRefs = [...input.environmentRefs];
  const environmentOverrides = { ...(input.environmentOverrides ?? {}) };
  validateEnvironmentOverrides(environmentOverrides);
  const resultSchemaPath = validateCodexArgs(input.args);
  validateCodexRuntimeBinding(input.args, environmentOverrides, input.credentialContext !== undefined);
  if (input.credentialContext) {
    environmentRefs = removeIndependentCredentialEnvironmentRefs(environmentRefs);
    const context = input.credentialContext;
    const apiKey = readAgentCredential(context.deploymentOrigin, context.userId, context.credentialRef);
    const codexHome = prepareIsolatedCodexHome(context.deploymentOrigin, context.userId);
    environmentOverrides.OPENAI_API_KEY = apiKey;
    environmentOverrides.CODEX_HOME = codexHome;
  }
  const resolution = resolveWorkspacePathImpl(input.cwd, input.cwd);
  resolveWorkspacePathImpl(resolution.workspaceRealpath, resultSchemaPath);
  const executable = resolveCodexExecutable(input.executable);
  const spec = Object.keys(environmentOverrides).length === 0
    ? buildCodexCommand({
      executable,
      cwd: resolution.targetRealpath,
      args: input.args,
      inheritedPath: process.env.PATH,
      environmentRefs,
    })
    : buildCodexCommandWithOverrides({
      executable,
      cwd: resolution.targetRealpath,
      args: input.args,
      inheritedPath: process.env.PATH,
      environmentRefs,
      environmentOverrides,
    });
  const child = spawn(spec.program, spec.args, {
    cwd: spec.cwd,
    env: spec.env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
    windowsHide: true,
  });
  const processId = child.pid;
  if (processId === undefined) {
    throw new Error("Failed to start Codex: process ID is unavailable");
  }
  input.registry.insertCodex(processId);
  const streams: Array<{ stream: "stdout" | "stderr"; source: NodeJS.ReadableStream }> = [];
  if (child.stdout) streams.push({ stream: "stdout", source: child.stdout });
  if (child.stderr) streams.push({ stream: "stderr", source: child.stderr });
  const readers = streams.map(({ stream, source }) => {
    const reader = createInterface({ input: source });
    reader.on("line", (line) => {
      const payload: CodexProcessOutput = {
        processKey: input.processKey,
        processId,
        stream,
        chunk: `${line}\n`,
      };
      input.host.send("codex_process_output", payload);
    });
    return reader;
  });
  child.once("error", () => {
    for (const reader of readers) reader.close();
    input.registry.remove(processId);
    const payload: CodexProcessExit = {
      processKey: input.processKey,
      processId,
      code: null,
      signal: "wait_failed",
    };
    input.host.send("codex_process_exit", payload);
  });
  child.once("exit", (code, signal) => {
    for (const reader of readers) reader.close();
    input.registry.remove(processId);
    const payload: CodexProcessExit = {
      processKey: input.processKey,
      processId,
      code,
      signal: code === null ? signal ?? "signal" : null,
    };
    input.host.send("codex_process_exit", payload);
  });
  return processId;
}

export function cancelCodexProcess(registry: ManagedCommandRegistry, processId: number): void {
  if (!registry.containsCodex(processId)) return;
  const spec = buildInterruptCommandSpec(desktopPlatformName(), processId);
  if (!spec) {
    throw new Error("Codex cancellation is unavailable on this platform");
  }
  const child = spawn(spec.program, spec.args, { stdio: "ignore", windowsHide: true });
  if (child.pid === undefined) {
    throw new Error("Codex could not be cancelled");
  }
}

export interface CommandLaunchResult {
  shell: string;
  processId: number | null;
  sessionName: string | null;
  sessionType: string | null;
}

export function launchProjectCommand(input: {
  host: ProcessHost;
  registry: ManagedCommandRegistry;
  cwd: string;
  command: string;
  taskId: string;
  projectId: string;
  workflowInstanceId: string;
  sessionName: string;
  sessionType: string;
}): CommandLaunchResult {
  const spec = buildManagedCommand(input.cwd, input.command);
  const child = spawn(spec.program, spec.args, {
    cwd: spec.cwd,
    stdio: ["ignore", "ignore", "ignore"],
    detached: process.platform !== "win32",
    windowsHide: true,
  });
  const processId = child.pid;
  if (processId === undefined) {
    throw new Error("Failed to launch project command: process ID is unavailable");
  }
  const externalSession =
    input.sessionName.trim().length > 0 && input.sessionType.trim() === "tmux";
  input.registry.insertProject(processId, externalSession);
  child.once("error", (error) => {
    input.registry.remove(processId);
    const payload: CommandExitedEvent = {
      taskId: input.taskId,
      projectId: input.projectId,
      workflowInstanceId: input.workflowInstanceId,
      cwd: input.cwd,
      command: input.command,
      processId,
      shell: spec.shell,
      status: "interrupted",
      exitCode: null,
      signal: null,
      error: `Failed to wait for command exit: ${error.message}`,
      sessionName: input.sessionName,
      sessionType: input.sessionType,
    };
    input.host.send("command_exited", payload);
  });
  child.once("exit", (code) => {
    input.registry.remove(processId);
    const payload: CommandExitedEvent = {
      taskId: input.taskId,
      projectId: input.projectId,
      workflowInstanceId: input.workflowInstanceId,
      cwd: input.cwd,
      command: input.command,
      processId,
      shell: spec.shell,
      status: code === 0 ? "completed" : "interrupted",
      exitCode: code,
      signal: null,
      sessionName: input.sessionName,
      sessionType: input.sessionType,
    };
    input.host.send("command_exited", payload);
  });
  return {
    shell: spec.shell,
    processId,
    sessionName: input.sessionName,
    sessionType: input.sessionType,
  };
}

export function restoreToolSession(input: {
  cwd: string;
  sessionName: string;
  sessionType: string;
}): CommandLaunchResult {
  const spec = buildRestoreSessionCommand(input.cwd, input.sessionName, input.sessionType);
  const child = spawn(spec.program, spec.args, {
    cwd: spec.cwd,
    stdio: ["ignore", "ignore", "ignore"],
    detached: process.platform !== "win32",
    windowsHide: true,
  });
  if (child.pid === undefined) {
    throw new Error("Failed to restore tool session: process ID is unavailable");
  }
  return {
    shell: spec.shell,
    processId: child.pid,
    sessionName: input.sessionName,
    sessionType: input.sessionType,
  };
}

export function openTerminalAtPath(path: string): CommandLaunchResult {
  const spec = buildTerminalLauncherCommand(path);
  const child = spawn(spec.program, spec.args, {
    stdio: ["ignore", "ignore", "ignore"],
    windowsHide: true,
  });
  if (child.pid === undefined) {
    throw new Error("Failed to open terminal at project path: process ID is unavailable");
  }
  return {
    shell: spec.shell,
    processId: child.pid,
    sessionName: null,
    sessionType: null,
  };
}
