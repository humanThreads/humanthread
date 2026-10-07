import { describe, expect, it } from "vitest";
import {
  buildManagedCommandPlan,
  buildTerminalLauncherPlan,
} from "./command-plan";

describe("buildTerminalLauncherPlan", () => {
  it("builds a macOS terminal launcher plan", () => {
    const result = buildTerminalLauncherPlan("macos", "/Users/demo/project");

    expect(result).toEqual({
      program: "osascript",
      args: [
        "-e",
        "tell application \"Terminal\" to activate",
        "-e",
        "tell application \"Terminal\" to do script \"cd '/Users/demo/project'\"",
      ],
      shellLabel: "osascript -> Terminal",
    });
  });

  it("builds a Windows terminal launcher plan", () => {
    const result = buildTerminalLauncherPlan("windows", "C:\\workspace\\demo");

    expect(result).toEqual({
      program: "cmd",
      args: [
        "/C",
        "start",
        "HumanThread",
        "cmd",
        "/K",
        "cd /d \"C:\\workspace\\demo\"",
      ],
      shellLabel: "cmd /C start",
    });
  });

  it("builds a Linux terminal launcher plan", () => {
    const result = buildTerminalLauncherPlan("linux", "/workspace/demo");

    expect(result.program).toBe("sh");
    expect(result.args[0]).toBe("-lc");
    expect(result.args[1]).toContain("x-terminal-emulator");
    expect(result.args[1]).toContain("cd '/workspace/demo'; exec \"$SHELL\"");
    expect(result.shellLabel).toBe("linux terminal launcher");
  });
});

describe("buildManagedCommandPlan", () => {
  it("builds a managed macOS command via sh -lc", () => {
    const result = buildManagedCommandPlan("macos", "/Users/demo/project", "pnpm test");

    expect(result).toEqual({
      program: "sh",
      args: ["-lc", "pnpm test"],
      shellLabel: "sh -lc",
      cwd: "/Users/demo/project",
    });
  });

  it("builds a managed Windows command via cmd /C", () => {
    const result = buildManagedCommandPlan("windows", "C:\\workspace\\demo", "npm test");

    expect(result).toEqual({
      program: "cmd",
      args: ["/C", "npm test"],
      shellLabel: "cmd /C",
      cwd: "C:\\workspace\\demo",
    });
  });

  it("rejects a blank managed command", () => {
    expect(() =>
      buildManagedCommandPlan("linux", "/workspace/demo", "   "),
    ).toThrow("Command is required.");
  });
});
