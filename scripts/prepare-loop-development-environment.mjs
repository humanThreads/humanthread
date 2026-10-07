import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PLACEHOLDER_DATABASE_URL = "mysql://humanthread:humanthread@127.0.0.1:3306/humanthread";
const COMMANDS = [
  ["pnpm", "db:generate"],
  [
    "pnpm",
    "--filter", "@humanthread/shared",
    "--filter", "@humanthread/workflow-core",
    "--filter", "@humanthread/orchestration-core",
    "--filter", "@humanthread/db",
    "--workspace-concurrency=1",
    "--sort",
    "build",
  ],
];

export function resolveCorepackCommand(args, platform = process.platform) {
  return platform === "win32"
    ? { executable: "cmd.exe", args: ["/d", "/s", "/c", "corepack", ...args] }
    : { executable: "corepack", args };
}

export function prepareLoopDevelopmentEnvironment(dependencies = {}) {
  const platform = dependencies.platform ?? process.platform;
  const run = dependencies.run ?? ((executable, args, options) => spawnSync(executable, args, options));
  const env = {
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL?.trim() || PLACEHOLDER_DATABASE_URL,
  };
  for (const args of COMMANDS) {
    const command = resolveCorepackCommand(args, platform);
    const result = run(command.executable, command.args, {
      cwd: process.cwd(), env, stdio: "inherit", shell: false,
    });
    if (result.error || result.status !== 0) {
      throw new Error(`Loop development environment preparation failed: ${command.executable} ${command.args.join(" ")}`);
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  prepareLoopDevelopmentEnvironment();
}
