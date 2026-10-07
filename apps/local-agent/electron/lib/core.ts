import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";

export const AGENT_RUNTIME_ENVIRONMENT_REFS = [
  "CODEX_HOME",
  "CLAUDE_CONFIG_DIR",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_ORGANIZATION",
  "OPENAI_PROJECT",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
] as const;

export const INDEPENDENT_CREDENTIAL_ENVIRONMENT_REFS = [
  "CODEX_HOME",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_ORGANIZATION",
  "OPENAI_PROJECT",
] as const;

const INHERITED_ENVIRONMENT_KEYS = [
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "TMPDIR",
  "TEMP",
  "TMP",
  "XDG_CONFIG_HOME",
] as const;

const LOGIN_PATH_MARKER = "__HUMANTHREAD_LOGIN_PATH__";
let cachedLoginShellPath: string | null = null;

export interface ProbeCommandOutput {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export function desktopPlatformName(): "macos" | "windows" | "linux" | "unknown" {
  if (process.platform === "darwin") return "macos";
  if (process.platform === "win32") return "windows";
  if (process.platform === "linux") return "linux";
  return "unknown";
}

export function assertUtf8Text(
  value: string,
  maximum: number,
  message: string,
): void {
  if (
    value.length === 0 ||
    value.length > maximum ||
    /[\u0000-\u001F\u007F]/u.test(value)
  ) {
    throw new Error(message);
  }
}

export function removeIndependentCredentialEnvironmentRefs(
  environmentRefs: string[],
): string[] {
  return environmentRefs.filter(
    (reference) => !(INDEPENDENT_CREDENTIAL_ENVIRONMENT_REFS as readonly string[]).includes(reference),
  );
}

export function validateEnvironmentRefs(environmentRefs: string[]): void {
  if (!Array.isArray(environmentRefs) || environmentRefs.length > 32) {
    throw new Error("Agent runtime environment references are invalid");
  }
  const unique = new Set<string>();
  for (const reference of environmentRefs) {
    const valid =
      typeof reference === "string" &&
      reference.length > 0 &&
      reference.length <= 128 &&
      /^[A-Za-z_][A-Za-z0-9_]*$/u.test(reference) &&
      (AGENT_RUNTIME_ENVIRONMENT_REFS as readonly string[]).includes(reference) &&
      !unique.has(reference);
    if (!valid) {
      throw new Error("Agent runtime environment references are invalid");
    }
    unique.add(reference);
  }
}

export function buildAgentProbePath(
  executable: string,
  inheritedPath: string | undefined,
): string | undefined {
  const entries: string[] = [];
  const parent = dirname(executable);
  if (parent && parent !== ".") entries.push(parent);
  if (inheritedPath) {
    entries.push(...inheritedPath.split(delimiter).filter((entry) => entry.length > 0));
  }
  if (entries.length === 0) return undefined;
  return entries.join(delimiter);
}

export function mergeCommandSearchPaths(
  ...pathValues: Array<string | undefined>
): string | undefined {
  const entries: string[] = [];
  const seen = new Set<string>();
  for (const value of pathValues) {
    for (const entry of (value ?? "").split(delimiter)) {
      const normalized = entry.trim();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      entries.push(normalized);
    }
  }
  return entries.length > 0 ? entries.join(delimiter) : undefined;
}

export function readLoginShellPath(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  if (platform === "win32") return undefined;
  const shell = environment.SHELL?.trim() || "/bin/zsh";
  try {
    const output = execFileSync(
      shell,
      ["-ilc", `printf '${LOGIN_PATH_MARKER}%s' "$PATH"`],
      {
        encoding: "utf8",
        env: environment,
        maxBuffer: 64 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 3_000,
      },
    );
    const markerIndex = output.lastIndexOf(LOGIN_PATH_MARKER);
    if (markerIndex < 0) return undefined;
    const resolved = output.slice(markerIndex + LOGIN_PATH_MARKER.length).trim();
    return resolved || undefined;
  } catch {
    return undefined;
  }
}

export function resolveCommandSearchPath(
  inheritedPath: string | undefined = process.env.PATH,
): string | undefined {
  if (cachedLoginShellPath === null) {
    cachedLoginShellPath = readLoginShellPath() ?? "";
  }
  return mergeCommandSearchPaths(
    inheritedPath,
    cachedLoginShellPath || undefined,
  );
}

export function buildInheritedCommandEnvironment(input: {
  executablePath: string | undefined;
  environmentRefs: string[];
}): Record<string, string> {
  const environment: Record<string, string> = {};
  const path = input.executablePath;
  if (path) environment.PATH = path;
  for (const key of [...INHERITED_ENVIRONMENT_KEYS, ...input.environmentRefs]) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}

function readBounded(stream: NodeJS.ReadableStream, limit: number): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let retained = 0;
    stream.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (retained >= limit) return;
      const remaining = limit - retained;
      const slice = buffer.subarray(0, remaining);
      chunks.push(slice);
      retained += slice.length;
    });
    const finish = () => resolve(Buffer.concat(chunks).toString("utf8"));
    stream.on("end", finish);
    stream.on("close", finish);
    stream.on("error", finish);
  });
}

export function killProcessTree(processId: number): void {
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/PID", String(processId), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } catch {
      // Best effort; the child may already be gone.
    }
    return;
  }
  try {
    process.kill(-processId, "SIGKILL");
  } catch {
    try {
      process.kill(processId, "SIGKILL");
    } catch {
      // Best effort; the child may already be gone.
    }
  }
}

export async function runCommandWithTimeout(input: {
  executable: string;
  args: string[];
  environmentRefs: string[];
  environmentOverrides?: Record<string, string>;
  timeoutMs: number;
  operation: string;
  cwd?: string;
}): Promise<ProbeCommandOutput> {
  const executablePath = buildAgentProbePath(
    input.executable,
    resolveCommandSearchPath(process.env.PATH),
  );
  const environment = buildInheritedCommandEnvironment({
    executablePath,
    environmentRefs: input.environmentRefs,
  });
  Object.assign(environment, input.environmentOverrides ?? {});
  const child = spawn(input.executable, input.args, {
    cwd: input.cwd,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
    windowsHide: true,
  });
  const stdoutPromise = readBounded(child.stdout as NodeJS.ReadableStream, 8_192);
  const stderrPromise = readBounded(child.stderr as NodeJS.ReadableStream, 8_192);
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    if (child.pid !== undefined) killProcessTree(child.pid);
    try {
      child.kill("SIGKILL");
    } catch {
      // The process may have exited between the timer and the kill.
    }
  }, input.timeoutMs);
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", (error) => reject(new Error(`Failed to start ${input.operation}: ${error.message}`)));
    child.once("close", (code) => resolve(code));
  }).finally(() => clearTimeout(timeout));
  const stdout = await stdoutPromise;
  const stderr = await stderrPromise;
  if (timedOut) {
    throw new Error(`${input.operation} timed out`);
  }
  return { exitCode, stdout, stderr };
}

export function resolveExecutableInPath(
  names: string[],
  pathValue: string | undefined,
  appDataDirectory?: string,
): string | undefined {
  const directories = (pathValue ?? "")
    .split(delimiter)
    .filter((entry) => entry.length > 0);
  if (process.platform === "win32" && appDataDirectory) {
    directories.unshift(join(appDataDirectory, "npm"));
  }
  for (const directory of directories) {
    for (const name of names) {
      const candidate = join(directory, name);
      try {
        accessSync(candidate, constants.R_OK);
        if (statSync(candidate).isFile()) return candidate;
      } catch {
        // Keep searching.
      }
    }
  }
  return undefined;
}

export interface InterruptCommandSpec {
  program: string;
  args: string[];
}

export function buildInterruptCommandSpec(
  platform: string,
  processId: number,
): InterruptCommandSpec | null {
  if (platform === "macos" || platform === "linux") {
    return { program: "kill", args: ["-TERM", `-${processId}`] };
  }
  if (platform === "windows") {
    return {
      program: "taskkill",
      args: ["/PID", String(processId), "/T", "/F"],
    };
  }
  return null;
}

export function interruptProcess(processId: number): void {
  const spec = buildInterruptCommandSpec(desktopPlatformName(), processId);
  if (!spec) {
    throw new Error("Managed command interruption is unavailable on this platform");
  }
  const child = spawn(spec.program, spec.args, { stdio: "ignore", windowsHide: true });
  child.once("error", () => {
    // Best effort; the process may already be gone.
  });
}

export function escapeSingleQuotedShell(value: string): string {
  return value.replaceAll("'", "'\\''");
}

export function escapeAppleScriptString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

export function escapeWindowsCmdArgument(value: string): string {
  return value.replaceAll('"', '""');
}

export interface LaunchCommandSpec {
  program: string;
  args: string[];
  cwd?: string;
  shell: string;
}

export function buildOpenCommand(path: string): LaunchCommandSpec {
  if (path.trim().length === 0) throw new Error("Project path is required.");
  if (process.platform === "darwin") {
    return { program: "open", args: [path], shell: "open" };
  }
  if (process.platform === "win32") {
    return { program: "explorer", args: [path], shell: "explorer" };
  }
  if (process.platform === "linux") {
    return { program: "xdg-open", args: [path], shell: "xdg-open" };
  }
  throw new Error("Unsupported platform for opening project paths.");
}

export function buildTerminalLauncherCommand(path: string): LaunchCommandSpec {
  if (path.trim().length === 0) throw new Error("Project path is required.");
  if (process.platform === "darwin") {
    const shellCommand = `cd '${escapeSingleQuotedShell(path)}'`;
    const appleScript = `tell application "Terminal" to do script "${escapeAppleScriptString(shellCommand)}"`;
    return {
      program: "osascript",
      args: ["-e", 'tell application "Terminal" to activate', "-e", appleScript],
      shell: "osascript -> Terminal",
    };
  }
  if (process.platform === "win32") {
    const commandLine = `cd /d "${escapeWindowsCmdArgument(path)}"`;
    return {
      program: "cmd",
      args: ["/C", "start", "HumanThread", "cmd", "/K", commandLine],
      shell: "cmd /C start",
    };
  }
  if (process.platform === "linux") {
    const shellCommand = `cd '${escapeSingleQuotedShell(path)}'; exec "$SHELL"`;
    const launcher = [
      "if command -v x-terminal-emulator >/dev/null 2>&1; then",
      `  exec x-terminal-emulator -e sh -lc '${shellCommand}';`,
      "elif command -v gnome-terminal >/dev/null 2>&1; then",
      `  exec gnome-terminal -- sh -lc '${shellCommand}';`,
      "elif command -v konsole >/dev/null 2>&1; then",
      `  exec konsole -e sh -lc '${shellCommand}';`,
      "elif command -v xterm >/dev/null 2>&1; then",
      `  exec xterm -e sh -lc '${shellCommand}';`,
      "else",
      "  exit 127;",
      "fi",
    ].join(" ");
    return { program: "sh", args: ["-lc", launcher], shell: "linux terminal launcher" };
  }
  throw new Error("Unsupported platform for opening terminals.");
}

export function buildManagedCommand(cwd: string, command: string): LaunchCommandSpec {
  if (cwd.trim().length === 0) throw new Error("Command working directory is required.");
  const normalizedCommand = command.trim();
  if (normalizedCommand.length === 0) throw new Error("Command is required.");
  if (process.platform === "win32") {
    return {
      program: "cmd",
      args: ["/C", normalizedCommand],
      cwd,
      shell: "cmd /C",
    };
  }
  return {
    program: "sh",
    args: ["-lc", normalizedCommand],
    cwd,
    shell: "sh -lc",
  };
}

export function buildRestoreSessionCommand(
  cwd: string,
  sessionName: string,
  sessionType: string,
): LaunchCommandSpec {
  if (cwd.trim().length === 0) throw new Error("Command working directory is required.");
  const normalizedSessionName = sessionName.trim();
  if (normalizedSessionName.length === 0) throw new Error("Session name is required.");
  const normalizedSessionType = sessionType.trim();
  if (normalizedSessionType.length === 0) throw new Error("Session type is required.");
  if (process.platform === "win32") {
    return buildTerminalLauncherCommand(cwd);
  }
  if (normalizedSessionType !== "tmux") {
    throw new Error(`Unsupported session type for restore: ${normalizedSessionType}`);
  }
  const sessionCommand = `tmux attach -t '${escapeSingleQuotedShell(normalizedSessionName)}'`;
  return {
    program: "sh",
    args: ["-lc", sessionCommand],
    cwd,
    shell: "sh -lc",
  };
}

export function spawnManagedSpec(spec: LaunchCommandSpec, input: { ignoreOutput: boolean }): ChildProcess {
  const stdio: "ignore" | "pipe" = input.ignoreOutput ? "ignore" : "pipe";
  return spawn(spec.program, spec.args, {
    cwd: spec.cwd,
    stdio: [input.ignoreOutput ? "ignore" : "pipe", stdio, stdio],
    detached: process.platform !== "win32",
    windowsHide: true,
  });
}
