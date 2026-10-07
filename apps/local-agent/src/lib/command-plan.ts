import type { LocalPlatform } from "./runtime";

export interface CommandPlan {
  program: string;
  args: string[];
  shellLabel: string;
  cwd?: string;
}

function escapeSingleQuotedShell(value: string): string {
  return value.replaceAll("'", "'\\''");
}

function escapeAppleScriptString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}

function escapeWindowsCmdArgument(value: string): string {
  return value.replaceAll("\"", "\"\"");
}

function requirePath(path: string): string {
  const normalized = path.trim();

  if (!normalized) {
    throw new Error("Project path is required.");
  }

  return normalized;
}

export function buildTerminalLauncherPlan(
  platform: LocalPlatform,
  path: string,
): CommandPlan {
  const normalizedPath = requirePath(path);

  if (platform === "macos") {
    const shellCommand = `cd '${escapeSingleQuotedShell(normalizedPath)}'`;

    return {
      program: "osascript",
      args: [
        "-e",
        "tell application \"Terminal\" to activate",
        "-e",
        `tell application "Terminal" to do script "${escapeAppleScriptString(shellCommand)}"`,
      ],
      shellLabel: "osascript -> Terminal",
    };
  }

  if (platform === "windows") {
    return {
      program: "cmd",
      args: [
        "/C",
        "start",
        "HumanThread",
        "cmd",
        "/K",
        `cd /d "${escapeWindowsCmdArgument(normalizedPath)}"`,
      ],
      shellLabel: "cmd /C start",
    };
  }

  if (platform === "linux") {
    const shellCommand = `cd '${escapeSingleQuotedShell(normalizedPath)}'; exec "$SHELL"`;
    const launcher = `if command -v x-terminal-emulator >/dev/null 2>&1; then \
exec x-terminal-emulator -e sh -lc '${shellCommand}'; \
elif command -v gnome-terminal >/dev/null 2>&1; then \
exec gnome-terminal -- sh -lc '${shellCommand}'; \
elif command -v konsole >/dev/null 2>&1; then \
exec konsole -e sh -lc '${shellCommand}'; \
elif command -v xterm >/dev/null 2>&1; then \
exec xterm -e sh -lc '${shellCommand}'; \
else \
exit 127; \
fi`;

    return {
      program: "sh",
      args: ["-lc", launcher],
      shellLabel: "linux terminal launcher",
    };
  }

  throw new Error("Unsupported platform for opening terminals.");
}

export function buildManagedCommandPlan(
  platform: LocalPlatform,
  cwd: string,
  command: string,
): CommandPlan {
  const normalizedCwd = requirePath(cwd);
  const normalizedCommand = command.trim();

  if (!normalizedCommand) {
    throw new Error("Command is required.");
  }

  if (platform === "windows") {
    return {
      program: "cmd",
      args: ["/C", normalizedCommand],
      shellLabel: "cmd /C",
      cwd: normalizedCwd,
    };
  }

  if (platform === "macos" || platform === "linux") {
    return {
      program: "sh",
      args: ["-lc", normalizedCommand],
      shellLabel: "sh -lc",
      cwd: normalizedCwd,
    };
  }

  throw new Error("Unsupported platform for launching project commands.");
}
