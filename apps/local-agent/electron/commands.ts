import { CodexAppServerRegistry } from "./lib/codex-app-server";
import type { CodexTuiBroker } from "./lib/codex-tui-broker";
import type { LiveSessionRuntime } from "./lib/live-session-runtime";
import {
  installAgentRuntimeImpl,
  probeAgentRuntimeImpl,
} from "./lib/agent-runtime";
import {
  buildOpenCommand,
  spawnManagedSpec,
  type ProbeCommandOutput,
} from "./lib/core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import {
  getAgentCredentialStatus,
  listModelSites,
  saveModelSite,
  saveModelDefaults,
  deleteModelSite,
  getModelCatalog,
  saveModelCatalog,
  getLoopModelRouting,
  saveLoopModelRouting,
  testAndRefreshModelSite,
  setAgentCredential,
  deleteAgentCredential,
  type ModelCatalogDocument,
  type ModelCatalogSite,
  type ModelSelection,
  type ModelSite,
  type LoopModelRoutingDocument,
  type AgentCredentialStatus,
} from "./lib/local-model";
import {
  ManagedCommandRegistry,
  cancelCodexProcess,
  launchProjectCommand,
  openTerminalAtPath,
  restoreToolSession,
  startCodexProcess,
  type CommandLaunchResult,
  type DesktopQuitState,
} from "./lib/processes";
import {
  createWorkspaceDirectoryImpl,
  createWorkspaceFileImpl,
  inspectWorkspaceGitImpl,
  listWorkspaceTreeImpl,
  prepareTaskWorktreeImpl,
  readWorkspaceFileImpl,
  removeWorkspaceSyncTransactionImpl,
  renameWorkspaceLoopPathImpl,
  replaceWorkspaceStructureFileImpl,
  resolveWorkspacePathImpl,
  runWorkspaceCheckImpl,
  validateWorkspaceDirectoryImpl,
  writeWorkspaceFileImpl,
} from "./lib/workspace";

export interface TrayMenuItemState {
  id: string;
  label: string;
  enabled: boolean;
  route?: string;
}

export interface TrayMenuState {
  items: TrayMenuItemState[];
}

export interface NativeNotificationInput {
  id: string;
  kind: string;
  title: string;
  body: string;
  route?: string;
}

export interface DesktopCommandHost {
  send(event: string, payload: unknown): void;
  updateTray(state: TrayMenuState): void;
  showNotification(input: NativeNotificationInput): Promise<void>;
  openExternal(url: string): Promise<void>;
  quitApplication(): void;
  modelFetch: (
    url: string,
    init: { headers: Record<string, string>; signal: AbortSignal },
  ) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;
}

export interface CommandContext {
  host: DesktopCommandHost;
  managed: ManagedCommandRegistry;
  codexServers: CodexAppServerRegistry;
  codexTui: CodexTuiBroker;
  liveSessions: LiveSessionRuntime;
}

export type CommandHandlerContext = { windowId: number };

const TRAY_ITEM_IDS = ["status", "current-task", "toggle-window", "self-check", "quit"];
const NOTIFICATION_KINDS = [
  "assignment",
  "approval",
  "blocker",
  "reminder",
  "command_completed",
  "command_failed",
];

function readArg<T>(args: Record<string, unknown>, ...keys: string[]): T {
  for (const key of keys) {
    const value = args[key];
    if (value !== undefined && value !== null) return value as T;
  }
  return undefined as T;
}

function requireString(args: Record<string, unknown>, ...keys: string[]): string {
  const value = readArg<unknown>(args, ...keys);
  if (typeof value !== "string") {
    throw new Error(`Native command argument is invalid: ${keys[0]}`);
  }
  return value;
}

function validateTrayItemIds(ids: string[]): void {
  if (ids.length !== TRAY_ITEM_IDS.length || ids.some((id, index) => id !== TRAY_ITEM_IDS[index])) {
    throw new Error("Tray menu items are invalid");
  }
}

function validateDesktopTaskRoute(route: string): void {
  if (!route.startsWith("/tasks/")) {
    throw new Error("Desktop Task route is invalid");
  }
  const taskId = route.slice("/tasks/".length);
  if (
    taskId.length === 0 ||
    taskId.length > 200 ||
    !/^[A-Za-z0-9_-]+$/u.test(taskId)
  ) {
    throw new Error("Desktop Task route is invalid");
  }
}

function validateDesktopNotificationRoute(id: string, route: string): void {
  try {
    validateDesktopTaskRoute(route);
    return;
  } catch {
    // Fall through to the Loop notification route contract.
  }
  if (!id.startsWith("loop-notification:") || !route.startsWith("/notifications?")) {
    throw new Error("Native notification route is invalid");
  }
  let parsed: URL;
  try {
    parsed = new URL(`https://desktop.humanthread.local${route}`);
  } catch {
    throw new Error("Native notification route is invalid");
  }
  if (parsed.pathname !== "/notifications" || parsed.hash.length > 0) {
    throw new Error("Native notification route is invalid");
  }
  const slots: Record<string, string | undefined> = {};
  for (const [key, value] of parsed.searchParams) {
    if (!["item", "read", "kind"].includes(key) || slots[key] !== undefined) {
      throw new Error("Native notification route is invalid");
    }
    slots[key] = value;
  }
  if (slots.item !== id || slots.read !== "all" || slots.kind !== "all") {
    throw new Error("Native notification route is invalid");
  }
}

function validateNativeNotificationSeverity(kind: string, title: string, body: string): void {
  if (!NOTIFICATION_KINDS.includes(kind)) {
    throw new Error("Native notification kind is invalid");
  }
  const titleLength = [...title.trim()].length;
  const bodyLength = [...body.trim()].length;
  if (
    titleLength === 0 ||
    titleLength > 80 ||
    bodyLength === 0 ||
    bodyLength > 240 ||
    /[\u0000-\u001F\u007F]/u.test(title) ||
    /[\u0000-\u001F\u007F]/u.test(body)
  ) {
    throw new Error("Native notification copy is invalid");
  }
}

function validateNativeNotificationTarget(id: string, route: string | undefined): void {
  const normalized = id.trim();
  if (
    normalized.length === 0 ||
    [...normalized].length > 128 ||
    !/^[A-Za-z0-9_:.-]+$/u.test(normalized)
  ) {
    throw new Error("Native notification id is invalid");
  }
  if (route !== undefined) {
    validateDesktopNotificationRoute(normalized, route);
  }
}

function resolveQuitState(context: CommandContext): DesktopQuitState {
  const { managedRunning, externalSession } = context.managed.quitState();
  return {
    managedRunning: managedRunning
      || context.codexServers.hasRunning()
      || context.codexTui.list().some((session) => session.status === "running" || session.status === "starting"),
    externalSession,
  };
}

function validateQuitChoiceForState(
  choice: string,
  state: DesktopQuitState,
): void {
  if (!["quit", "keep_session_and_quit", "interrupt_and_quit"].includes(choice)) {
    throw new Error("Desktop quit choice is invalid");
  }
  const allowed =
    choice === "quit"
      ? !state.managedRunning && !state.externalSession
      : choice === "keep_session_and_quit"
        ? state.externalSession
        : state.managedRunning;
  if (!allowed) {
    throw new Error("Desktop quit choice is unavailable for the current process state");
  }
}

export function isAllowedWebHandoffUrl(value: string, deploymentUrl: string): boolean {
  let target: URL;
  let deployment: URL;
  try {
    target = new URL(value.trim());
    deployment = new URL(deploymentUrl.trim());
  } catch {
    return false;
  }
  if (
    target.origin !== deployment.origin ||
    target.pathname !== "/api/desktop/web-handoff/consume" ||
    target.username.length > 0 ||
    target.password.length > 0 ||
    target.hash.length > 0
  ) {
    return false;
  }
  const code = target.searchParams.get("code")?.trim() ?? "";
  return target.searchParams.size === 1 && code.length > 0 && code.length <= 256;
}

export type CommandHandler = (
  args: Record<string, unknown>,
  context?: CommandHandlerContext,
) => unknown | Promise<unknown>;

function requireWindowId(context: CommandHandlerContext | undefined): number {
  const windowId = context?.windowId;
  if (typeof windowId !== "number" || !Number.isSafeInteger(windowId) || windowId <= 0) {
    throw new Error("Desktop window id is invalid");
  }
  return windowId;
}

function validateTuiBase64(value: string): void {
  if (
    value.length === 0 ||
    value.length > Math.ceil(256 * 1024 * 4 / 3) + 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)
  ) {
    throw new Error("Codex TUI input is invalid");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length === 0 || bytes.length > 256 * 1024) {
    throw new Error("Codex TUI input is invalid");
  }
}

function tuiSessionArgs(args: Record<string, unknown>): {
  sessionId: string;
  runId: string;
  taskId: string | null;
  projectId: string | null;
  nodeKey: string | null;
  processKey: string;
  threadId: string;
  cwd: string;
  model: string | null;
} {
  const optional = (key: string): string | null => {
    const value = readArg<unknown>(args, key);
    if (value === undefined || value === null) return null;
    if (typeof value !== "string") throw new Error(`Native command argument is invalid: ${key}`);
    return value;
  };
  return {
    sessionId: requireString(args, "sessionId", "session_id"),
    runId: requireString(args, "runId", "run_id"),
    taskId: optional("taskId"),
    projectId: optional("projectId"),
    nodeKey: optional("nodeKey"),
    processKey: requireString(args, "processKey", "process_key"),
    threadId: requireString(args, "threadId", "thread_id"),
    cwd: requireString(args, "cwd"),
    model: optional("model"),
  };
}

export function createCommandHandlers(context: CommandContext): Record<string, CommandHandler> {
  const handlers: Record<string, CommandHandler> = {
    prepare_direct_agent_workspace: (args) => {
      const deviceId = requireString(args, "deviceId", "device_id");
      const sessionId = requireString(args, "sessionId", "session_id");
      if (!/^[a-f0-9]{32}$/u.test(sessionId) || !/^[A-Za-z0-9_-]{1,96}$/u.test(deviceId)) {
        throw new Error("Direct Agent Workspace identity is invalid");
      }
      const root = join(app.getPath("userData"), "direct-agent-sessions", deviceId, sessionId);
      mkdirSync(root, { recursive: true, mode: 0o700 });
      return root;
    },
    validate_workspace_directory: (args) =>
      validateWorkspaceDirectoryImpl(requireString(args, "path")),
    resolve_workspace_path: (args) =>
      resolveWorkspacePathImpl(requireString(args, "workspaceRoot", "workspace_root"), requireString(args, "requestedPath", "requested_path")),
    inspect_workspace_git: (args) =>
      inspectWorkspaceGitImpl(requireString(args, "workspaceRoot", "workspace_root"), requireString(args, "requestedPath", "requested_path")),
    prepare_task_worktree: (args) =>
      prepareTaskWorktreeImpl(
        requireString(args, "workspaceRoot", "workspace_root"),
        requireString(args, "taskBranch", "task_branch"),
        requireString(args, "baseBranch", "base_branch"),
      ),
    read_workspace_file: (args) =>
      readWorkspaceFileImpl(
        requireString(args, "workspaceRoot", "workspace_root"),
        requireString(args, "requestedPath", "requested_path"),
        readArg<number>(args, "maxBytes", "max_bytes") ?? 0,
      ),
    run_workspace_check: (args) =>
      runWorkspaceCheckImpl({
        workspaceRoot: requireString(args, "workspaceRoot", "workspace_root"),
        command: requireString(args, "command"),
        timeoutMs: readArg<number>(args, "timeoutMs", "timeout_ms") ?? 0,
      }),
    write_workspace_file: (args) =>
      writeWorkspaceFileImpl(
        requireString(args, "workspaceRoot", "workspace_root"),
        requireString(args, "requestedPath", "requested_path"),
        requireString(args, "content"),
      ),
    list_workspace_tree: (args) =>
      listWorkspaceTreeImpl(
        requireString(args, "workspaceRoot", "workspace_root"),
        requireString(args, "requestedPath", "requested_path"),
        readArg<number>(args, "maxEntries", "max_entries") ?? 0,
      ),
    create_workspace_directory: (args) =>
      createWorkspaceDirectoryImpl(
        requireString(args, "workspaceRoot", "workspace_root"),
        requireString(args, "requestedPath", "requested_path"),
      ),
    create_workspace_file: (args) =>
      createWorkspaceFileImpl(
        requireString(args, "workspaceRoot", "workspace_root"),
        requireString(args, "requestedPath", "requested_path"),
        requireString(args, "content"),
      ),
    replace_workspace_structure_file: (args) =>
      replaceWorkspaceStructureFileImpl(
        requireString(args, "workspaceRoot", "workspace_root"),
        requireString(args, "requestedPath", "requested_path"),
        requireString(args, "content"),
      ),
    rename_workspace_loop_path: (args) =>
      renameWorkspaceLoopPathImpl(
        requireString(args, "workspaceRoot", "workspace_root"),
        requireString(args, "fromPath", "from_path"),
        requireString(args, "toPath", "to_path"),
      ),
    remove_workspace_sync_transaction: (args) =>
      removeWorkspaceSyncTransactionImpl(
        requireString(args, "workspaceRoot", "workspace_root"),
        requireString(args, "requestedPath", "requested_path"),
      ),

    probe_agent_runtime: (args) =>
      probeAgentRuntimeImpl({
        provider: requireString(args, "provider"),
        command: requireString(args, "command"),
        environmentRefs: readArg<string[]>(args, "environmentRefs", "environment_refs") ?? [],
        ...(typeof readArg<unknown>(args, "credential") === "string"
          ? { credential: readArg<string>(args, "credential") }
          : {}),
        ...(readArg<unknown>(args, "credentialContext", "credential_context") !== undefined
          ? { credentialContext: readArg(args, "credentialContext", "credential_context") as {
            deploymentOrigin: string;
            userId: string;
            credentialRef: string;
          } }
          : {}),
      }),
    install_agent_runtime: (args) =>
      installAgentRuntimeImpl({
        provider: requireString(args, "provider"),
        environmentRefs: readArg<string[]>(args, "environmentRefs", "environment_refs") ?? [],
      }),

    start_codex_process: (args) =>
      startCodexProcess({
        host: context.host,
        registry: context.managed,
        processKey: requireString(args, "processKey", "process_key"),
        cwd: requireString(args, "cwd"),
        executable: requireString(args, "executable"),
        args: readArg<string[]>(args, "args") ?? [],
        environmentRefs: readArg<string[]>(args, "environmentRefs", "environment_refs") ?? [],
        ...(readArg<unknown>(args, "environmentOverrides", "environment_overrides") !== undefined
          ? { environmentOverrides: readArg<Record<string, string>>(args, "environmentOverrides", "environment_overrides") }
          : {}),
        ...(readArg<unknown>(args, "credentialContext", "credential_context") !== undefined
          ? { credentialContext: readArg(args, "credentialContext", "credential_context") as {
            deploymentOrigin: string;
            userId: string;
            credentialRef: string;
          } }
          : {}),
      }),
    cancel_codex_process: (args) => {
      cancelCodexProcess(context.managed, readArg<number>(args, "processId", "process_id") ?? 0);
      return null;
    },

    start_codex_app_server: (args) => {
      const input = readArg(args, "input") as Parameters<CodexAppServerRegistry["start"]>[0];
      return context.codexServers.start(input);
    },
    request_codex_app_server: (args) =>
      context.codexServers.request(
        requireString(args, "processKey", "process_key"),
        requireString(args, "method"),
        readArg<unknown>(args, "params") ?? null,
      ),
    notify_codex_app_server: (args) =>
      context.codexServers.notify(
        requireString(args, "processKey", "process_key"),
        requireString(args, "method"),
        readArg<unknown>(args, "params") ?? null,
      ),
    respond_codex_app_server: (args) =>
      context.codexServers.respond(
        requireString(args, "processKey", "process_key"),
        readArg<unknown>(args, "requestId", "request_id"),
        readArg<unknown>(args, "result"),
        readArg<unknown>(args, "error"),
      ),
    cancel_codex_app_server: (args) =>
      context.codexServers.cancel(
        requireString(args, "processKey", "process_key"),
        requireString(args, "threadId", "thread_id"),
        typeof readArg<unknown>(args, "turnId", "turn_id") === "string"
          ? readArg<string>(args, "turnId", "turn_id")
          : undefined,
      ),
    stop_codex_app_server: (args) => {
      context.codexServers.stop(requireString(args, "processKey", "process_key"));
      return null;
    },
    list_codex_app_servers: () => context.codexServers.states(),

    register_codex_tui_session: (args) => {
      context.codexTui.register(tuiSessionArgs(args));
      return null;
    },
    start_codex_tui_session: (args) => context.codexTui.start(tuiSessionArgs(args)),
    unregister_codex_tui_session: (args) => {
      context.codexTui.unregister(requireString(args, "sessionId", "session_id"));
      return null;
    },
    freeze_codex_tui_session: async (args) => {
      await context.codexTui.freeze(requireString(args, "sessionId", "session_id"));
      return null;
    },
    list_codex_tui_sessions: () => context.codexTui.list(),
    spawn_codex_tui: (args, handlerContext) => context.codexTui.spawn({
      ...tuiSessionArgs(args),
      windowId: requireWindowId(handlerContext),
    }),
    attach_codex_tui: (args, handlerContext) => context.codexTui.attach(
      requireString(args, "sessionId", "session_id"),
      requireWindowId(handlerContext),
    ),
    reattach_codex_tui: (args, handlerContext) => context.codexTui.reattach(
      requireString(args, "sessionId", "session_id"),
      requireWindowId(handlerContext),
    ),
    detach_codex_tui: (args, handlerContext) => context.codexTui.detach(
      requireString(args, "sessionId", "session_id"),
      requireWindowId(handlerContext),
    ),
    write_codex_tui: async (args, handlerContext) => {
      const deltaBase64 = requireString(args, "deltaBase64", "delta_base64");
      validateTuiBase64(deltaBase64);
      await context.codexTui.write(
        requireString(args, "sessionId", "session_id"),
        requireWindowId(handlerContext),
        deltaBase64,
      );
      return null;
    },
    resize_codex_tui: async (args, handlerContext) => {
      const rows = readArg<number>(args, "rows") ?? 0;
      const cols = readArg<number>(args, "cols") ?? 0;
      if (!Number.isSafeInteger(rows) || rows < 1 || rows > 500 || !Number.isSafeInteger(cols) || cols < 1 || cols > 1000) {
        throw new Error("Codex TUI terminal size is invalid");
      }
      await context.codexTui.resize(
        requireString(args, "sessionId", "session_id"),
        requireWindowId(handlerContext),
        rows,
        cols,
      );
      return null;
    },
    acquire_codex_tui_control: (args, handlerContext) => context.codexTui.acquire(
      requireString(args, "sessionId", "session_id"),
      requireWindowId(handlerContext),
    ),
    release_codex_tui_control: (args, handlerContext) => context.codexTui.release(
      requireString(args, "sessionId", "session_id"),
      requireWindowId(handlerContext),
    ),
    close_codex_tui: async (args) => {
      await context.codexTui.close(requireString(args, "sessionId", "session_id"));
      return null;
    },
    open_live_session: async (args) => {
      await context.liveSessions.open({
        sessionId: requireString(args, "sessionId", "session_id"),
        relayUrl: requireString(args, "relayUrl", "relay_url"),
        authorization: requireString(args, "authorization"),
      });
      return null;
    },
    close_live_session: async (args) => {
      await context.liveSessions.close(requireString(args, "sessionId", "session_id"));
      return null;
    },
    live_session_state: (args) => context.liveSessions.state(requireString(args, "sessionId", "session_id")),

    get_agent_credential_status: (args): AgentCredentialStatus =>
      getAgentCredentialStatus({
        deploymentOrigin: requireString(args, "deploymentOrigin", "deployment_origin"),
        userId: requireString(args, "userId", "user_id"),
        credentialRef: requireString(args, "credentialRef", "credential_ref"),
      }),
    set_agent_credential: (args): AgentCredentialStatus =>
      setAgentCredential({
        deploymentOrigin: requireString(args, "deploymentOrigin", "deployment_origin"),
        userId: requireString(args, "userId", "user_id"),
        credentialRef: requireString(args, "credentialRef", "credential_ref"),
        kind: requireString(args, "kind"),
        apiKey: requireString(args, "apiKey", "api_key"),
      }),
    delete_agent_credential: (args): AgentCredentialStatus =>
      deleteAgentCredential({
        deploymentOrigin: requireString(args, "deploymentOrigin", "deployment_origin"),
        userId: requireString(args, "userId", "user_id"),
        credentialRef: requireString(args, "credentialRef", "credential_ref"),
      }),
    list_model_sites: (args) =>
      listModelSites({
        deploymentOrigin: requireString(args, "deploymentOrigin", "deployment_origin"),
        userId: requireString(args, "userId", "user_id"),
      }),
    save_model_site: (args) =>
      saveModelSite({
        deploymentOrigin: requireString(args, "deploymentOrigin", "deployment_origin"),
        userId: requireString(args, "userId", "user_id"),
        site: readArg(args, "site") as ModelSite,
        accountDefault: (readArg(args, "accountDefault", "account_default") ?? null) as ModelSelection | null,
      }),
    save_model_defaults: (args) =>
      saveModelDefaults({
        deploymentOrigin: requireString(args, "deploymentOrigin", "deployment_origin"),
        userId: requireString(args, "userId", "user_id"),
        accountDefault: (readArg(args, "accountDefault", "account_default") ?? null) as ModelSelection | null,
      }),
    delete_model_site: (args) =>
      deleteModelSite({
        deploymentOrigin: requireString(args, "deploymentOrigin", "deployment_origin"),
        userId: requireString(args, "userId", "user_id"),
        siteId: requireString(args, "siteId", "site_id"),
      }),
    get_model_catalog: (args) =>
      getModelCatalog({
        deploymentOrigin: requireString(args, "deploymentOrigin", "deployment_origin"),
        userId: requireString(args, "userId", "user_id"),
      }),
    save_model_catalog: (args) =>
      saveModelCatalog({
        deploymentOrigin: requireString(args, "deploymentOrigin", "deployment_origin"),
        userId: requireString(args, "userId", "user_id"),
        catalog: readArg(args, "catalog") as ModelCatalogDocument,
      }),
    get_loop_model_routing: (args) =>
      getLoopModelRouting({
        deploymentOrigin: requireString(args, "deploymentOrigin", "deployment_origin"),
        userId: requireString(args, "userId", "user_id"),
      }),
    save_loop_model_routing: (args) =>
      saveLoopModelRouting({
        deploymentOrigin: requireString(args, "deploymentOrigin", "deployment_origin"),
        userId: requireString(args, "userId", "user_id"),
        routing: readArg(args, "routing") as LoopModelRoutingDocument,
      }),
    test_and_refresh_model_site: (args) =>
      testAndRefreshModelSite({
        deploymentOrigin: requireString(args, "deploymentOrigin", "deployment_origin"),
        userId: requireString(args, "userId", "user_id"),
        site: readArg(args, "site") as ModelSite,
        ...(readArg<unknown>(args, "catalog") !== undefined && readArg<unknown>(args, "catalog") !== null
          ? { catalog: readArg(args, "catalog") as ModelCatalogSite }
          : {}),
        ...(typeof readArg<unknown>(args, "credential") === "string"
          ? { credential: readArg<string>(args, "credential") }
          : {}),
        fetch: context.host.modelFetch,
      }),

    set_tray_menu: (args) => {
      const state = readArg(args, "state") as TrayMenuState;
      if (!state || !Array.isArray(state.items)) {
        throw new Error("Tray menu items are invalid");
      }
      validateTrayItemIds(state.items.map((item) => item.id));
      for (const item of state.items) {
        const label = item.label.trim();
        if (label.length === 0 || [...label].length > 96 || /[\u0000-\u001F\u007F]/u.test(label)) {
          throw new Error("Tray menu label is invalid");
        }
        if (item.id === "current-task") {
          if (item.route !== undefined) {
            try {
              validateDesktopTaskRoute(item.route);
            } catch {
              throw new Error("Tray current Task route is invalid");
            }
          }
        } else if (item.route !== undefined) {
          throw new Error("Tray menu route is invalid");
        }
      }
      context.host.updateTray(state);
      return null;
    },
    send_native_notification: async (args) => {
      const kind = requireString(args, "kind");
      const title = requireString(args, "title");
      const body = requireString(args, "body");
      const id = requireString(args, "id");
      const route = typeof readArg<unknown>(args, "route") === "string"
        ? readArg<string>(args, "route")
        : undefined;
      validateNativeNotificationSeverity(kind, title, body);
      validateNativeNotificationTarget(id, route);
      await context.host.showNotification({ id, kind, title, body, ...(route === undefined ? {} : { route }) });
      return null;
    },
    desktop_quit_state: () => resolveQuitState(context),
    open_web_handoff: async (args) => {
      const url = requireString(args, "url");
      const deploymentUrl = requireString(args, "deploymentUrl", "deployment_url");
      if (!isAllowedWebHandoffUrl(url, deploymentUrl)) {
        throw new Error("Web handoff URL is not allowed");
      }
      await context.host.openExternal(url);
      return null;
    },
    quit_desktop: async (args) => {
      const choice = requireString(args, "choice");
      const state = resolveQuitState(context);
      validateQuitChoiceForState(choice, state);
      if (choice === "interrupt_and_quit") {
        context.managed.interruptAll();
        await context.codexTui.closeAll();
        context.codexServers.stopAll();
      }
      context.host.quitApplication();
      return null;
    },

    open_terminal_at_path: (args) => openTerminalAtPath(requireString(args, "path")),
    open_project_path: (args) => {
      const spec = buildOpenCommand(requireString(args, "path"));
      const child = spawnManagedSpec(spec, { ignoreOutput: true });
      return new Promise<void>((resolvePromise, rejectPromise) => {
        child.once("error", (error) => rejectPromise(new Error(`Failed to run open command: ${error.message}`)));
        child.once("exit", (code) => {
          if (code === 0) resolvePromise();
          else rejectPromise(new Error(`Open command exited with status: exit code ${code ?? "unknown"}`));
        });
      });
    },
    launch_project_command: (args): CommandLaunchResult =>
      launchProjectCommand({
        host: context.host,
        registry: context.managed,
        cwd: requireString(args, "cwd"),
        command: requireString(args, "command"),
        taskId: requireString(args, "taskId", "task_id"),
        projectId: requireString(args, "projectId", "project_id"),
        workflowInstanceId: requireString(args, "workflowInstanceId", "workflow_instance_id"),
        sessionName: requireString(args, "sessionName", "session_name"),
        sessionType: requireString(args, "sessionType", "session_type"),
      }),
    restore_tool_session: (args): CommandLaunchResult =>
      restoreToolSession({
        cwd: requireString(args, "cwd"),
        sessionName: requireString(args, "sessionName", "session_name"),
        sessionType: requireString(args, "sessionType", "session_type"),
      }),
  };
  return handlers;
}

export type { ProbeCommandOutput };
