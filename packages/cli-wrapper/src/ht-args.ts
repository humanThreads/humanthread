export type HtArgs =
  | { command: "login"; email: string; passwordStdin: boolean; json: boolean }
  | { command: "init"; projectId?: string; json: boolean }
  | { command: "doctor"; json: boolean }
  | { command: "repair"; stageId: string; json: boolean }
  | { command: "migrate"; stageId: string; json: boolean }
  | { command: "worker_run"; platformUrl: string; poolTokenEnv: string; stateDir: string; json: boolean }
  | { command: "version"; json: boolean }
  | { command: "help"; json: boolean };

function argumentError(message: string): Error {
  return Object.assign(new Error(message), { code: "invalid_arguments" });
}

function optionValue(argv: string[], option: string): string | undefined {
  const index = argv.indexOf(option);
  if (index < 0) return undefined;
  const value = argv[index + 1]?.trim();
  if (!value || value.startsWith("--")) throw argumentError(`${option} requires a value`);
  return value;
}

export function parseHtArgs(argv: string[]): HtArgs {
  const command = argv[0] ?? "help";
  const json = argv.includes("--json");
  if (command === "help" || command === "--help" || command === "-h") return { command: "help", json };
  if (command === "--version" || command === "-v") return { command: "version", json };
  if (command === "login") {
    const email = optionValue(argv, "--email");
    if (!email) throw argumentError("ht login requires --email <email>");
    return { command, email, passwordStdin: argv.includes("--password-stdin"), json };
  }
  if (command === "init") {
    const projectId = optionValue(argv, "--project");
    return { command, ...(projectId ? { projectId } : {}), json };
  }
  if (command === "doctor") return { command, json };
  if (command === "repair") {
    const stageId = optionValue(argv, "--stage");
    if (!stageId) throw argumentError("ht repair requires --stage <loop-id>/<subloop-id>");
    return { command, stageId, json };
  }
  if (command === "migrate") {
    const stageId = optionValue(argv, "--stage");
    if (!stageId) throw argumentError("ht migrate requires --stage <loop-id>/<subloop-id>");
    return { command, stageId, json };
  }
  if (command === "worker") {
    if (argv[1] !== "run") throw argumentError("ht worker requires the run subcommand");
    const platformUrl = optionValue(argv, "--platform-url");
    const poolTokenEnv = optionValue(argv, "--pool-token-env");
    const stateDir = optionValue(argv, "--state-dir");
    if (!platformUrl) throw argumentError("ht worker run requires --platform-url");
    try { new URL(platformUrl); } catch { throw argumentError("--platform-url must be an absolute URL"); }
    if (!poolTokenEnv || !/^[A-Z][A-Z0-9_]{0,127}$/u.test(poolTokenEnv)) {
      throw argumentError("ht worker run requires --pool-token-env <ENV_NAME>");
    }
    if (!stateDir || !stateDir.startsWith("/")) throw argumentError("ht worker run requires an absolute --state-dir");
    return { command: "worker_run", platformUrl, poolTokenEnv, stateDir, json };
  }
  throw argumentError(`Unknown ht command: ${command}`);
}
