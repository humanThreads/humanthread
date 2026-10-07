import { spawn as nodeSpawn } from "node:child_process";

const MAX_CATALOG_BYTES = 8 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MODEL_INSTRUCTIONS = "You are Codex, a coding agent working in a shared workspace. Use the available tools to complete the user's task, follow the repository's instructions, and report results clearly.";

const REASONING_LEVELS = [
  { effort: "low", description: "Fast responses with lighter reasoning" },
  { effort: "medium", description: "Balances speed and reasoning depth for everyday tasks" },
  { effort: "high", description: "Greater reasoning depth for complex coding and agent tasks" },
  { effort: "xhigh", description: "Extra-high reasoning depth for difficult tasks" },
  { effort: "max", description: "Maximum reasoning depth for complex tasks" },
  { effort: "ultra", description: "Maximum reasoning with automatic task delegation" },
] as const;

type CatalogEntry = Record<string, unknown>;

function fallbackModelEntry(model: string, reasoningEffort = "high"): CatalogEntry {
  const supportedLevels = REASONING_LEVELS.filter(({ effort }) => (
    effort === "low" || effort === "medium" || effort === "high" || effort === "max" || effort === reasoningEffort
  ));
  return {
    slug: model,
    display_name: model,
    description: "HumanThread relayed coding model.",
    default_reasoning_level: reasoningEffort,
    supported_reasoning_levels: supportedLevels,
    shell_type: "unified_exec",
    visibility: "list",
    supported_in_api: true,
    priority: 50,
    additional_speed_tiers: [],
    service_tiers: [],
    default_service_tier: null,
    availability_nux: null,
    upgrade: null,
    model_messages: { instructions_template: DEFAULT_MODEL_INSTRUCTIONS },
    include_skills_usage_instructions: false,
    include_plugin_usage_instructions: false,
    include_apps_usage_instructions: false,
    supports_reasoning_summary_parameter: false,
    default_reasoning_summary: "none",
    support_verbosity: false,
    default_verbosity: null,
    apply_patch_tool_type: "freeform",
    web_search_tool_type: "text",
    truncation_policy: { mode: "tokens", limit: 10_000 },
    supports_image_detail_original: false,
    supports_parallel_tool_calls: true,
    context_window: 128_000,
    max_context_window: 128_000,
    auto_compact_token_limit: null,
    comp_hash: null,
    effective_context_window_percent: 95,
    experimental_supported_tools: [],
    input_modalities: ["text"],
    supports_search_tool: false,
    use_responses_lite: false,
    node_repl_auto_review_required: false,
    node_repl_disabled: false,
    auto_review_model_override: null,
    model_specialty: null,
    tool_mode: "direct",
    multi_agent_version: null,
  };
}

function relayedModelEntry(model: string, reasoningEffort: string, template?: CatalogEntry | null): CatalogEntry {
  const supportedLevels = REASONING_LEVELS.map((level) => ({ ...level }));
  if (!template) {
    return { ...fallbackModelEntry(model, reasoningEffort), supported_reasoning_levels: supportedLevels };
  }
  return {
    ...template,
    slug: model,
    display_name: model,
    description: "HumanThread relayed coding model.",
    default_reasoning_level: reasoningEffort,
    supported_reasoning_levels: supportedLevels,
    shell_type: "unified_exec",
    visibility: "list",
    supported_in_api: true,
    tool_mode: "direct",
    use_responses_lite: false,
    supports_reasoning_summary_parameter: false,
    default_reasoning_summary: "none",
    upgrade: null,
    availability_nux: null,
  };
}

export function createRelayModelCatalog(model: string, reasoningEffort = "high"): string {
  return JSON.stringify({ models: [relayedModelEntry(model, reasoningEffort)] });
}

type ReaderChild = {
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  once(event: "exit", listener: (code: number | null) => void): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
  kill(signal?: NodeJS.Signals): unknown;
};

type ReaderSpawn = (
  command: string,
  args: string[],
  options: { env: Record<string, string>; stdio: ["ignore", "pipe", "pipe"] },
) => ReaderChild;

/**
 * Codex ships a bundled model catalog that can mark first-party models as
 * code-mode-only. Relayed third-party models cannot call the JavaScript code
 * mode entrypoint, so the worker rewrites the leased model entry to expose the
 * standard direct tool surface (`exec_command`, `apply_patch`, ...) and the
 * regular Responses payload shape.
 */
export function patchModelCatalogForDirectTools(
  rawCatalog: string,
  model: string,
  reasoningEffort = "high",
): string | null {
  if (!model) return null;
  let catalog: unknown;
  try {
    catalog = JSON.parse(rawCatalog);
  } catch {
    return null;
  }
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) return null;
  const models = Reflect.get(catalog, "models");
  if (!Array.isArray(models)) return null;
  let changed = false;
  let template: CatalogEntry | null = null;
  let selectedFound = false;
  const patched = models.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
    const candidate = entry as CatalogEntry;
    if (
      !template
      && Reflect.get(candidate, "tool_mode") !== "code_mode_only"
      && Reflect.get(candidate, "use_responses_lite") === false
    ) {
      template = candidate;
    }
    if (Reflect.get(entry, "slug") !== model) return entry;
    selectedFound = true;
    if (
      Reflect.get(entry, "tool_mode") === "direct"
      && Reflect.get(entry, "use_responses_lite") === false
      && Reflect.get(entry, "supports_reasoning_summary_parameter") === false
      && Reflect.get(entry, "default_reasoning_summary") === "none"
    ) {
      return entry;
    }
    changed = true;
    return relayedModelEntry(model, reasoningEffort, candidate);
  });
  if (!selectedFound) {
    return JSON.stringify({
      ...catalog,
      models: [...patched, relayedModelEntry(model, reasoningEffort, template)],
    });
  }
  return JSON.stringify({ ...catalog, models: patched });
}

export type BundledModelCatalogReader = (executable: string, codexHome: string) => Promise<string | null>;

/**
 * Reads the catalog that the installed Codex build embeds. The read runs in a
 * clean environment so it cannot refresh the catalog from the leased model
 * site and cannot depend on assignment credentials.
 */
export function createBundledModelCatalogReader(dependencies: {
  spawn?: ReaderSpawn;
  timeoutMs?: number;
  pathEnvironment?: string;
} = {}): BundledModelCatalogReader {
  const spawn = dependencies.spawn ?? (nodeSpawn as unknown as ReaderSpawn);
  const timeoutMs = dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pathEnvironment = dependencies.pathEnvironment ?? process.env.PATH;
  return (executable, codexHome) => new Promise((resolve) => {
    let settled = false;
    let output = "";
    let child: ReaderChild | null = null;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child?.kill("SIGTERM"); } catch { /* the reader is best effort */ }
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    try {
      child = spawn(executable, ["debug", "models"], {
        env: {
          HOME: codexHome,
          CODEX_HOME: codexHome,
          ...(pathEnvironment === undefined || pathEnvironment === "" ? {} : { PATH: pathEnvironment }),
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      finish(null);
      return;
    }
    child.stdout.on("data", (chunk: Buffer | string) => {
      output += String(chunk);
      if (Buffer.byteLength(output, "utf8") > MAX_CATALOG_BYTES) finish(null);
    });
    child.once("error", () => finish(null));
    child.once("exit", (code) => finish(code === 0 && output.trim() !== "" ? output : null));
  });
}
