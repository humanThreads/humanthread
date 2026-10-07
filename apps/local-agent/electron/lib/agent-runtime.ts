import { basename, delimiter, dirname, extname, isAbsolute, join } from "node:path";
import { readdirSync, statSync } from "node:fs";
import { parse as parseToml } from "smol-toml";

import {
  buildAgentProbePath,
  buildInheritedCommandEnvironment,
  resolveCommandSearchPath,
  runCommandWithTimeout,
  validateEnvironmentRefs,
  type ProbeCommandOutput,
} from "./core";
import { readAgentCredential, type CredentialContext } from "./local-model";

export interface AgentRuntimeProbeResult {
  provider: string;
  status: string;
  semanticVersion: string | null;
  authentication: string;
  capabilities: string[];
}

export interface AgentRuntimeInstallResult {
  provider: string;
  packageName: string;
  status: string;
}

function providerExecutableNames(provider: string): string[] {
  if (provider === "codex") {
    return process.platform === "win32" ? ["codex", "codex.cmd", "codex.exe"] : ["codex"];
  }
  if (provider === "claude") {
    return process.platform === "win32" ? ["claude", "claude.cmd", "claude.exe"] : ["claude"];
  }
  throw new Error("Agent runtime Provider is invalid");
}

function providerPackageName(provider: string): string {
  if (provider === "codex") return "@openai/codex";
  if (provider === "claude") return "@anthropic-ai/claude-code";
  throw new Error("Agent runtime Provider is invalid");
}

function npmExecutableName(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function validateAgentExecutable(provider: string, command: string): void {
  const expectedNames = providerExecutableNames(provider);
  if (command.length === 0 || command.length > 1_024 || /[\u0000-\u001F\u007F]/u.test(command)) {
    throw new Error("Agent runtime executable is invalid");
  }
  if (!isAbsolute(command) && (command.includes("/") || command.includes("\\"))) {
    throw new Error("Relative Agent runtime executable paths are forbidden");
  }
  const fileName = basename(command);
  if (!expectedNames.some((expected) => fileName.toLowerCase() === expected.toLowerCase())) {
    throw new Error("Agent runtime executable is not allowlisted for the Provider");
  }
}

function providerExecutablePathCandidates(provider: string, command: string): string[] {
  validateAgentExecutable(provider, command);
  if (isAbsolute(command)) return [command];
  if (process.platform !== "win32") return [command];
  const requestedName = basename(command);
  const allowedNames = providerExecutableNames(provider);
  const requestedHasExtension = extname(requestedName).length > 0;
  const names = requestedHasExtension
    ? [requestedName]
    : allowedNames.filter((name) => extname(name).length > 0);
  if (!names.some((name) => name.toLowerCase() === requestedName.toLowerCase())) {
    names.push(requestedName);
  }
  return names;
}

function windowsCodexNativeCandidates(launcherDirectory: string): string[] {
  const isArm = process.arch === "arm64";
  const platformPackage = isArm ? "codex-win32-arm64" : "codex-win32-x64";
  const targetTriple = isArm ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
  const openaiPackages = join(launcherDirectory, "node_modules", "@openai");
  const suffix = join("vendor", targetTriple, "bin", "codex.exe");
  return [
    join(openaiPackages, "codex", "node_modules", "@openai", platformPackage, suffix),
    join(openaiPackages, platformPackage, suffix),
  ];
}

function resolveWindowsCodexNative(launcherDirectory: string): string | undefined {
  return windowsCodexNativeCandidates(launcherDirectory).find((candidate) => fileExists(candidate));
}

function fileExists(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function resolveAgentExecutableIn(input: {
  provider: string;
  command: string;
  pathValue: string | undefined;
  appData: string | undefined;
}): string | undefined {
  const candidates = providerExecutablePathCandidates(input.provider, input.command);
  if (isAbsolute(input.command)) {
    if (
      process.platform === "win32" &&
      input.provider === "codex" &&
      (extname(input.command) === "" || extname(input.command).toLowerCase() === ".cmd")
    ) {
      return fileExists(input.command)
        ? resolveWindowsCodexNative(dirname(input.command))
        : undefined;
    }
    return candidates.find((candidate) => fileExists(candidate));
  }
  const directories = (input.pathValue ?? "")
    .split(delimiter)
    .filter((entry) => entry.length > 0);
  if (process.platform === "win32" && input.provider === "codex") {
    if (input.appData) directories.unshift(join(input.appData, "npm"));
    for (const directory of directories) {
      const native = resolveWindowsCodexNative(directory);
      if (native) return native;
    }
    return directories
      .map((directory) => join(directory, "codex.exe"))
      .find((candidate) => fileExists(candidate));
  }
  for (const directory of directories) {
    for (const candidate of candidates) {
      const path = join(directory, candidate);
      if (fileExists(path)) return path;
    }
  }
  return undefined;
}

export function resolveAgentExecutable(provider: string, command: string): string | undefined {
  return resolveAgentExecutableIn({
    provider,
    command,
    pathValue: resolveCommandSearchPath(process.env.PATH),
    appData: process.env.APPDATA,
  });
}

export function resolveCodexExecutable(command: string): string {
  const executable = resolveAgentExecutable("codex", command);
  if (executable) return executable;
  if (command !== "codex") {
    throw new Error("Configured Codex executable was not found");
  }
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (!home) throw new Error("Codex executable was not found");
  const versions = join(home, ".nvm", "versions", "node");
  let entries: string[];
  try {
    entries = readdirSync(versions);
  } catch {
    throw new Error("Codex executable was not found");
  }
  const candidates = entries
    .map((entry) => join(versions, entry, process.platform === "win32" ? "codex.exe" : "bin/codex"))
    .filter((candidate) => fileExists(candidate))
    .sort();
  const resolved = candidates[candidates.length - 1];
  if (!resolved) throw new Error("Codex executable was not found");
  return resolved;
}

function extractSemanticVersion(output: string): string | null {
  for (const rawPart of output.split(/[\s,()]+/u)) {
    const part = rawPart.replace(/^[^A-Za-z0-9.+-]+|[^A-Za-z0-9.+-]+$/gu, "");
    const core = part.split(/[-+]/u)[0] ?? "";
    const segments = core.split(".");
    if (
      segments.length === 3 &&
      segments.every((segment) => segment.length > 0 && /^\d+$/u.test(segment))
    ) {
      return part;
    }
  }
  return null;
}

function sanitizeRuntimeProbe(
  provider: string,
  exitCode: number | null,
  stdout: string,
  stderr: string,
): AgentRuntimeProbeResult {
  const normalized = `${stdout}\n${stderr}`.toLowerCase();
  const unauthenticated = [
    "login required",
    "not logged in",
    "unauthenticated",
    "authentication required",
  ].some((marker) => normalized.includes(marker));
  const [status, authentication] = exitCode === 0
    ? ["ready", "authenticated"]
    : unauthenticated
      ? ["unauthenticated", "unauthenticated"]
      : ["missing", "unknown"];
  return {
    provider,
    status,
    semanticVersion: extractSemanticVersion(normalized),
    authentication,
    capabilities: [],
  };
}

function runProbeCommand(
  executable: string,
  args: string[],
  environmentRefs: string[],
  environmentOverrides: Record<string, string>,
): Promise<ProbeCommandOutput> {
  return runCommandWithTimeout({
    executable,
    args,
    environmentRefs,
    environmentOverrides,
    timeoutMs: 5_000,
    operation: "Agent runtime probe",
  });
}

export async function probeAgentRuntimeImpl(input: {
  provider: string;
  command: string;
  environmentRefs: string[];
  credential?: string;
  credentialContext?: CredentialContext;
}): Promise<AgentRuntimeProbeResult> {
  validateEnvironmentRefs(input.environmentRefs);
  if ((input.credential !== undefined || input.credentialContext !== undefined) && input.provider !== "codex") {
    throw new Error("Independent credentials are only supported for Codex");
  }
  const environmentOverrides: Record<string, string> = {};
  if (input.credential !== undefined) {
    const value = input.credential.trim();
    if (value.length === 0 || value.length > 4_096 || /[\u0000-\u001F\u007F]/u.test(value)) {
      throw new Error("Codex credential input is invalid");
    }
    environmentOverrides.OPENAI_API_KEY = value;
  } else if (input.credentialContext !== undefined) {
    environmentOverrides.OPENAI_API_KEY = readAgentCredential(
      input.credentialContext.deploymentOrigin,
      input.credentialContext.userId,
      input.credentialContext.credentialRef,
    );
  }
  const executable = resolveAgentExecutable(input.provider, input.command);
  if (!executable) {
    return {
      provider: input.provider,
      status: "missing",
      semanticVersion: null,
      authentication: "unknown",
      capabilities: [],
    };
  }
  const version = await runProbeCommand(executable, ["--version"], input.environmentRefs, environmentOverrides);
  if (version.exitCode !== 0) {
    return sanitizeRuntimeProbe(input.provider, version.exitCode, version.stdout, version.stderr);
  }
  const authArgs = input.provider === "codex" ? ["login", "status"] : ["auth", "status"];
  const authentication = await runProbeCommand(executable, authArgs, input.environmentRefs, environmentOverrides);
  const authenticated = authentication.exitCode === 0;
  return {
    provider: input.provider,
    status: authenticated ? "ready" : "unauthenticated",
    semanticVersion: extractSemanticVersion(`${version.stdout}\n${version.stderr}`),
    authentication: authenticated ? "authenticated" : "unauthenticated",
    capabilities: authenticated
      ? ["approvals", "session_resume", "structured_result"]
      : [],
  };
}

export async function installAgentRuntimeImpl(input: {
  provider: string;
  environmentRefs: string[];
}): Promise<AgentRuntimeInstallResult> {
  validateEnvironmentRefs(input.environmentRefs);
  const packageName = providerPackageName(input.provider);
  const installEnvironmentRefs = input.environmentRefs.filter((reference) =>
    ["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS"].includes(reference),
  );
  const result = await runCommandWithTimeout({
    executable: npmExecutableName(),
    args: ["install", "--global", packageName],
    environmentRefs: installEnvironmentRefs,
    timeoutMs: 300_000,
    operation: "Agent runtime installation",
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to install ${input.provider} runtime (exit code ${
        result.exitCode === null ? "unknown" : String(result.exitCode)
      })`,
    );
  }
  return { provider: input.provider, packageName, status: "installed" };
}

export function codexLocalModelProviderBaseUrl(args: string[]): string | null {
  if (args[1] !== "--config") return null;
  const expected: Array<[number, string]> = [
    [1, "--config"],
    [2, 'model_provider="humanthread_local"'],
    [3, "--config"],
    [4, 'model_providers.humanthread_local.name="HumanThread Desktop"'],
    [5, "--config"],
    [7, "--config"],
    [8, 'model_providers.humanthread_local.env_key="OPENAI_API_KEY"'],
    [9, "--config"],
    [10, 'model_providers.humanthread_local.wire_api="responses"'],
    [11, "--config"],
    [12, "model_providers.humanthread_local.requires_openai_auth=false"],
  ];
  if (
    args.length <= 13 ||
    args[0] !== "exec" ||
    expected.some(([index, value]) => args[index] !== value)
  ) {
    throw new Error("Codex local model provider arguments are invalid");
  }
  const rawBaseUrl = args[6];
  if (rawBaseUrl === undefined || !rawBaseUrl.startsWith("model_providers.humanthread_local.base_url=")) {
    throw new Error("Codex local model provider arguments are invalid");
  }
  const tomlValue = rawBaseUrl.slice("model_providers.humanthread_local.base_url=".length);
  let parsedConfig: Record<string, unknown>;
  try {
    parsedConfig = parseToml(`value = ${tomlValue}`) as Record<string, unknown>;
  } catch {
    throw new Error("Codex local model provider arguments are invalid");
  }
  const baseUrl = parsedConfig.value;
  if (typeof baseUrl !== "string") {
    throw new Error("Codex local model provider arguments are invalid");
  }
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("Codex local model provider arguments are invalid");
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0
  ) {
    throw new Error("Codex local model provider arguments are invalid");
  }
  return baseUrl;
}

function validateCodexLocalModelProvider(args: string[]): { commandArgs: string[]; baseUrl: string | null } {
  const baseUrl = codexLocalModelProviderBaseUrl(args);
  const commandArgs = baseUrl !== null
    ? [args[0] as string, ...args.slice(13)]
    : [...args];
  return { commandArgs, baseUrl };
}

function validateCodexReasoningEffort(args: string[]): string[] {
  const PREFIX = "model_reasoning_effort=";
  const commandArgs: string[] = [];
  let selected: string | null = null;
  let index = 0;
  while (index < args.length) {
    if (args[index] === "--config" && args[index + 1]?.startsWith(PREFIX)) {
      if (selected !== null) {
        throw new Error("Codex reasoning effort arguments are invalid");
      }
      const value = (args[index + 1] as string).slice(PREFIX.length);
      const efforts: Record<string, string> = {
        '"low"': "low",
        '"medium"': "medium",
        '"high"': "high",
        '"xhigh"': "xhigh",
        '"max"': "max",
        '"ultra"': "ultra",
      };
      const effort = efforts[value];
      if (effort === undefined) {
        throw new Error("Codex reasoning effort arguments are invalid");
      }
      selected = effort;
      index += 2;
      continue;
    }
    commandArgs.push(args[index] as string);
    index += 1;
  }
  if (selected === null) {
    throw new Error("Codex reasoning effort arguments are invalid");
  }
  return commandArgs;
}

export function validateCodexArgs(args: string[]): string {
  const provider = validateCodexLocalModelProvider(args);
  const commandArgs = validateCodexReasoningEffort(provider.commandArgs);
  const validPrompt = (value: string) => value.length > 0 && value.length <= 131_072 && !value.includes("\0");
  const validModel = (flag: string, value: string) =>
    flag === "--model" &&
    value.length > 0 &&
    value.length <= 512 &&
    !/[\u0000-\u001F\u007F]/u.test(value);
  const validSessionId = (value: string) =>
    value.length > 0 && value.length <= 128 && /^[A-Za-z0-9_:.-]+$/u.test(value);
  const match = (
    pattern: Array<string | null>,
    checks: Array<((value: string) => boolean) | null>,
    schemaIndex: number,
  ): string | null => {
    if (commandArgs.length !== pattern.length) return null;
    for (let index = 0; index < pattern.length; index += 1) {
      const expected = pattern[index];
      const value = commandArgs[index] as string;
      const check = checks[index];
      if (expected !== null) {
        if (value !== expected) return null;
      } else if (check && !check(value)) {
        return null;
      }
    }
    return commandArgs[schemaIndex] as string;
  };

  const patterns: Array<{ pattern: Array<string | null>; checks: Array<((value: string) => boolean) | null>; schemaIndex: number }> = [
    {
      pattern: ["exec", "--json", "--sandbox", "read-only", "--output-schema", null, null],
      checks: [null, null, null, null, null, (value) => value.length > 0 && value.length <= 1_024, validPrompt],
      schemaIndex: 5,
    },
    {
      pattern: ["exec", "--json", "--sandbox", "read-only", "--model", null, "--output-schema", null, null],
      checks: [null, null, null, null, (value) => validModel("--model", value), null, (value) => value.length > 0 && value.length <= 1_024, validPrompt],
      schemaIndex: 7,
    },
    {
      pattern: ["exec", "--json", "--dangerously-bypass-approvals-and-sandbox", "--output-schema", null, null],
      checks: [null, null, null, null, (value) => value.length > 0 && value.length <= 1_024, validPrompt],
      schemaIndex: 4,
    },
    {
      pattern: ["exec", "--json", "--dangerously-bypass-approvals-and-sandbox", "--model", null, "--output-schema", null, null],
      checks: [null, null, null, (value) => validModel("--model", value), null, (value) => value.length > 0 && value.length <= 1_024, validPrompt],
      schemaIndex: 6,
    },
    {
      pattern: ["exec", "--sandbox", "read-only", "resume", null, "--json", "--output-schema", null, null],
      checks: [null, null, null, null, validSessionId, null, null, (value) => value.length > 0 && value.length <= 1_024, validPrompt],
      schemaIndex: 7,
    },
    {
      pattern: ["exec", "--sandbox", "read-only", "resume", null, "--json", "--model", null, "--output-schema", null, null],
      checks: [null, null, null, null, validSessionId, null, (value) => validModel("--model", value), null, (value) => value.length > 0 && value.length <= 1_024, validPrompt],
      schemaIndex: 9,
    },
    {
      pattern: ["exec", "--dangerously-bypass-approvals-and-sandbox", "resume", null, "--json", "--output-schema", null, null],
      checks: [null, null, null, validSessionId, null, null, (value) => value.length > 0 && value.length <= 1_024, validPrompt],
      schemaIndex: 6,
    },
    {
      pattern: ["exec", "--dangerously-bypass-approvals-and-sandbox", "resume", null, "--json", "--model", null, "--output-schema", null, null],
      checks: [null, null, null, validSessionId, null, (value) => validModel("--model", value), null, (value) => value.length > 0 && value.length <= 1_024, validPrompt],
      schemaIndex: 8,
    },
  ];
  let resultSchema: string | null = null;
  for (const candidate of patterns) {
    resultSchema = match(candidate.pattern, candidate.checks, candidate.schemaIndex);
    if (resultSchema !== null) break;
  }
  if (resultSchema === null) {
    throw new Error("Codex arguments are invalid");
  }
  if (resultSchema.length > 1_024 || resultSchema.includes("\0")) {
    throw new Error("Codex result Schema path is invalid");
  }
  if (provider.baseUrl !== null) {
    const modelCount = commandArgs.reduce(
      (count, value) => count + (value === "--model" ? 1 : 0),
      0,
    );
    if (modelCount !== 1) {
      throw new Error("Codex local model provider requires an explicit model");
    }
  }
  return resultSchema;
}

export function validateCodexRuntimeBinding(
  args: string[],
  environmentOverrides: Record<string, string>,
  hasIndependentCredential: boolean,
): void {
  const providerBaseUrl = codexLocalModelProviderBaseUrl(args);
  if (hasIndependentCredential && providerBaseUrl === null) {
    throw new Error("Independent Codex credentials require the selected local model provider");
  }
  if (providerBaseUrl !== null && environmentOverrides.OPENAI_BASE_URL !== providerBaseUrl) {
    throw new Error("Codex local model provider does not match the selected model site");
  }
}

export function validateEnvironmentOverrides(overrides: Record<string, string>): void {
  for (const [key, value] of Object.entries(overrides)) {
    if (
      key !== "OPENAI_BASE_URL" ||
      value.length === 0 ||
      value.length > 2_048 ||
      /[\u0000-\u001F\u007F]/u.test(value)
    ) {
      throw new Error("Codex environment overrides are invalid");
    }
  }
}

export function validateCodexCommandEnvironment(overrides: Record<string, string>): void {
  for (const [key, value] of Object.entries(overrides)) {
    const valid =
      key === "OPENAI_BASE_URL"
        ? value.length > 0 && value.length <= 2_048 && !/[\u0000-\u001F\u007F]/u.test(value)
        : key === "OPENAI_API_KEY"
          ? value.length > 0 && value.length <= 4_096 && !/[\u0000-\u001F\u007F]/u.test(value)
          : key === "CODEX_HOME"
            ? value.length > 0 && value.length <= 4_096 && !/[\u0000-\u001F\u007F]/u.test(value)
            : false;
    if (!valid) {
      throw new Error("Codex environment overrides are invalid");
    }
  }
}

export interface CodexCommandSpec {
  program: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

export function buildCodexCommandWithOverrides(input: {
  executable: string;
  cwd: string;
  args: string[];
  inheritedPath: string | undefined;
  environmentRefs: string[];
  environmentOverrides: Record<string, string>;
}): CodexCommandSpec {
  validateCodexCommandEnvironment(input.environmentOverrides);
  const executablePath = buildAgentProbePath(input.executable, input.inheritedPath);
  const environment = buildInheritedCommandEnvironment({
    executablePath,
    environmentRefs: input.environmentRefs,
  });
  Object.assign(environment, input.environmentOverrides);
  return {
    program: input.executable,
    args: [...input.args],
    cwd: input.cwd,
    env: environment,
  };
}

export function buildCodexCommand(input: {
  executable: string;
  cwd: string;
  args: string[];
  inheritedPath: string | undefined;
  environmentRefs: string[];
}): CodexCommandSpec {
  return buildCodexCommandWithOverrides({ ...input, environmentOverrides: {} });
}
