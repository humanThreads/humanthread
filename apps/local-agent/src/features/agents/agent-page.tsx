import {
  desktopAgentMutationResponseSchema,
  desktopAgentsResponseSchema,
  desktopLoopDetailResponseSchema,
  desktopLoopInteractionConfirmRequestSchema,
  desktopLoopInteractionDecisionRequestSchema,
  desktopLoopInteractionMessageRequestSchema,
  desktopLoopInteractionMutationResponseSchema,
} from "@humanthread/workbench-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";

import { useDesktopSession } from "../../session/session-provider";
import {
  agentQueryKey,
  agentLoopDetailQueryKey,
  buildAgentSearch,
  createAgentCommandMetadata,
  parseAgentQuery,
  type AgentLoopPanel,
  type AgentView,
} from "./agent-queries";
import { AgentWorkspaceView } from "./agent-workspace";
import { AgentLoopDetail } from "./agent-loop-detail";
import { LocalTerminalPage } from "./local-terminal-page";
import { LocalTerminalView } from "./local-terminal-view";
import { createCodexTuiClient, type CodexTuiSession } from "../../lib/codex-tui-client";
import { getNativeBridge } from "../../lib/native-bridge";

function createUnavailableTuiClient(): ReturnType<typeof createCodexTuiClient> {
  const unavailable = async (): Promise<never> => {
    throw new Error("本机终端仅在桌面客户端中可用。");
  };
  return {
    register: unavailable,
    start: unavailable,
    unregister: unavailable,
    list: async () => [],
    spawn: unavailable,
    attach: unavailable,
    reattach: unavailable,
    detach: unavailable,
    write: unavailable,
    resize: unavailable,
    acquire: unavailable,
    release: unavailable,
    close: unavailable,
    subscribeOutput: async () => () => undefined,
    subscribeState: async () => () => undefined,
  };
}

export function AgentPage(props: {
  render(input: { content: ReactNode }): ReactNode;
}) {
  const session = useDesktopSession();
  const nativeBridge = getNativeBridge();
  const tuiClient = useMemo(() => nativeBridge
    ? createCodexTuiClient({
      invoke: nativeBridge.invoke.bind(nativeBridge),
      listen: nativeBridge.listen.bind(nativeBridge),
    })
    : null, [nativeBridge]);
  const [tuiSessions, setTuiSessions] = useState<CodexTuiSession[]>([]);
  const [tuiError, setTuiError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const query = parseAgentQuery(searchParams);
  const spaceSearch = session.context
    ? new URLSearchParams({ space: session.context.spaceKey }).toString()
    : "";
  const agentsQuery = useQuery({
    enabled: Boolean(session.client && session.context),
    queryKey: session.context
      ? agentQueryKey(session.context)
      : ["desktop", "agents", "disabled"],
    queryFn: async () => {
      if (!session.client) throw new Error("桌面会话不可用");
      return session.client.request(
        `/api/desktop/agents?${spaceSearch}`,
        desktopAgentsResponseSchema,
      );
    },
  });

  const refreshTuiSessions = useCallback(async () => {
    if (!tuiClient) {
      setTuiSessions([]);
      return;
    }
    try {
      setTuiSessions(await tuiClient.list());
      setTuiError(null);
    } catch (error) {
      setTuiError(error instanceof Error ? error.message : "本机终端列表加载失败");
    }
  }, [tuiClient]);

  useEffect(() => {
    if (!tuiClient || query.view !== "terminals") return;
    let disposed = false;
    let stopState: (() => void) | undefined;
    void refreshTuiSessions();
    void tuiClient.subscribeState((next) => {
      if (disposed) return;
      setTuiSessions((current) => [
        ...current.filter((item) => item.sessionId !== next.sessionId),
        next,
      ]);
    }).then((stop) => disposed ? stop() : (stopState = stop)).catch((error) => {
      if (!disposed) setTuiError(error instanceof Error ? error.message : "本机终端监听失败");
    });
    return () => {
      disposed = true;
      stopState?.();
    };
  }, [query.view, refreshTuiSessions, tuiClient]);
  const loopDetailQuery = useQuery({
    enabled: Boolean(session.client && session.context && query.loopId),
    queryKey: session.context && query.loopId
      ? agentLoopDetailQueryKey(session.context, query.loopId)
      : ["desktop", "agent-loop-detail", "disabled"],
    queryFn: async () => {
      if (!session.client || !query.loopId) throw new Error("桌面会话不可用");
      return session.client.request(
        `/api/desktop/agents/loops/${encodeURIComponent(query.loopId)}?${spaceSearch}`,
        desktopLoopDetailResponseSchema,
      );
    },
    refetchInterval: query.loopId ? 3_000 : false,
    refetchIntervalInBackground: false,
  });

  async function invalidateAgents() {
    if (!session.context) return;
    await queryClient.invalidateQueries({ queryKey: agentQueryKey(session.context) });
  }

  async function invalidateLoopDetail() {
    if (!session.context || !query.loopId) return;
    await queryClient.invalidateQueries({ queryKey: agentLoopDetailQueryKey(session.context, query.loopId) });
  }

  const loopMutation = useMutation({
    mutationFn: async (input: { loopId: string; command: "start" | "pause" | "resume" | "cancel"; expectedVersion: number }) => {
      if (!session.client || !session.actionsEnabled) throw new Error("桌面会话当前不可写");
      return session.client.request(
        `/api/desktop/agents/loops/${encodeURIComponent(input.loopId)}?${spaceSearch}`,
        desktopAgentMutationResponseSchema,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...createAgentCommandMetadata("loop"),
            command: input.command,
            expectedVersion: input.expectedVersion,
          }),
        },
      );
    },
    onSuccess: invalidateAgents,
  });

  const approvalMutation = useMutation({
    mutationFn: async (input: { approvalId: string; decision: "approved" | "rejected"; reason: string }) => {
      if (!session.client || !session.actionsEnabled) throw new Error("桌面会话当前不可写");
      return session.client.request(
        `/api/desktop/agents/approvals/${encodeURIComponent(input.approvalId)}?${spaceSearch}`,
        desktopAgentMutationResponseSchema,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...createAgentCommandMetadata("approval"),
            decision: input.decision,
            reason: input.reason,
          }),
        },
      );
    },
    onSuccess: invalidateAgents,
  });

  const interactionMutation = useMutation({
    mutationFn: async (input:
      | { kind: "message"; interactionId: string; expectedVersion: number; body: string }
      | { kind: "confirm"; interactionId: string; expectedVersion: number; reason: string }
      | { kind: "decision"; interactionId: string; expectedVersion: number; decision: "approved" | "rejected"; reason: string; selectedEdgeId: string }
    ) => {
      if (!session.client || !session.actionsEnabled || !query.loopId) throw new Error("桌面会话当前不可写");
      const base = `/api/desktop/agents/loops/${encodeURIComponent(query.loopId)}/interactions/${encodeURIComponent(input.interactionId)}`;
      if (input.kind === "message") {
        const requestBody = desktopLoopInteractionMessageRequestSchema.parse({
          ...createAgentCommandMetadata("loop"),
          expectedVersion: input.expectedVersion,
          message: { body: input.body, answers: {}, attachmentIds: [], mentionedUserIds: [] },
        });
        return session.client.request(`${base}/messages?${spaceSearch}`, desktopLoopInteractionMutationResponseSchema, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(requestBody),
        });
      }
      if (input.kind === "confirm") {
        const requestBody = desktopLoopInteractionConfirmRequestSchema.parse({
          ...createAgentCommandMetadata("loop"), expectedVersion: input.expectedVersion, reason: input.reason,
        });
        return session.client.request(`${base}/confirm?${spaceSearch}`, desktopLoopInteractionMutationResponseSchema, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(requestBody),
        });
      }
      const requestBody = desktopLoopInteractionDecisionRequestSchema.parse({
        ...createAgentCommandMetadata("loop"), expectedVersion: input.expectedVersion,
        decision: input.decision, reason: input.reason, selectedEdgeId: input.selectedEdgeId,
      });
      return session.client.request(`${base}/decision?${spaceSearch}`, desktopLoopInteractionMutationResponseSchema, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(requestBody),
      });
    },
    onSuccess: async () => {
      await Promise.all([invalidateAgents(), invalidateLoopDetail()]);
    },
  });

  function changeView(view: AgentView) {
    setSearchParams(buildAgentSearch({ ...query, view }), { replace: true });
  }

  function selectTerminalSession(sessionId: string) {
    setSearchParams(buildAgentSearch({
      ...query,
      view: "terminals",
      ...(sessionId ? { sessionId } : {}),
    }), { replace: true });
  }

  async function closeTerminalSession(sessionId: string) {
    if (!tuiClient) return;
    await tuiClient.close(sessionId);
    setTuiSessions((current) => current.filter((item) => item.sessionId !== sessionId));
    if (query.sessionId === sessionId) selectTerminalSession("");
  }

  function selectLoop(loopId: string, loopPanel: AgentLoopPanel = "runtime") {
    setSearchParams(buildAgentSearch({ ...query, view: "loops", loopId, loopPanel }), { replace: true });
  }

  function selectLoopPanel(loopPanel: AgentLoopPanel) {
    if (!query.loopId) return;
    setSearchParams(buildAgentSearch({ ...query, view: "loops", loopPanel }), { replace: true });
  }

  function closeLoopDetail() {
    const { loopId: _loopId, loopPanel: _loopPanel, ...withoutLoop } = query;
    setSearchParams(buildAgentSearch({ ...withoutLoop, view: "loops" }), { replace: true });
  }

  if (agentsQuery.isPending) {
    return props.render({ content: <div aria-label="正在加载 Agent 控制台" className="feature-loading-state" /> });
  }
  if (agentsQuery.isError) {
    return props.render({ content: <p className="feature-error-state" role="alert">{agentsQuery.error.message}</p> });
  }

  const data = agentsQuery.data.data;
  const loopDetail = loopDetailQuery.data?.data ?? null;
  const loopTerminal = loopDetail
    ? tuiSessions.find((item) => item.runId === loopDetail.agentRunId)
      ?? tuiSessions.find((item) => item.runId === query.loopId)
      ?? null
    : null;
  return props.render({
    content: <AgentWorkspaceView
      activeView={query.view}
      data={data}
      selectedLoopId={query.loopId ?? null}
      onLoopSelect={selectLoop}
      onApprovalDecision={async (input) => { await approvalMutation.mutateAsync(input); }}
      onLoopCommand={async (input) => { await loopMutation.mutateAsync(input); }}
      onViewChange={changeView}
      terminalContent={query.view === "terminals" ? <>
        {tuiError ? <p className="agent-action-notice" data-tone="error" role="alert">{tuiError}</p> : null}
        <LocalTerminalPage
          client={tuiClient ?? createUnavailableTuiClient()}
          sessions={tuiSessions}
          selectedSessionId={query.sessionId ?? null}
          onRefresh={refreshTuiSessions}
          onOpen={(sessionId) => selectTerminalSession(sessionId)}
          onClose={closeTerminalSession}
          onError={setTuiError}
        />
      </> : null}
      loopDetail={query.loopId ? <AgentLoopDetail
        detail={loopDetailQuery.data?.data ?? null}
        error={loopDetailQuery.error instanceof Error ? loopDetailQuery.error : loopDetailQuery.isError ? new Error("Loop 详情暂时无法加载") : null}
        isLoading={loopDetailQuery.isPending}
        initialTab={query.loopPanel ?? "runtime"}
        actionsEnabled={session.actionsEnabled}
        onClose={closeLoopDetail}
        onTabChange={selectLoopPanel}
        onMessage={(input) => { void interactionMutation.mutateAsync({ kind: "message", ...input }); }}
        onConfirm={(input) => { void interactionMutation.mutateAsync({ kind: "confirm", ...input }); }}
        onDecision={(input) => { void interactionMutation.mutateAsync({ kind: "decision", ...input }); }}
        hasLocalTerminal={Boolean(loopTerminal)}
        terminalContent={loopTerminal ? <LocalTerminalView
          client={tuiClient ?? createUnavailableTuiClient()}
          session={loopTerminal}
          onError={setTuiError}
        /> : null}
      /> : null}
    />,
  });
}
