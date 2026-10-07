import {
  desktopDocumentDetailResponseSchema,
  desktopDocumentRevisionsResponseSchema,
  desktopDocumentTreeResponseSchema,
  desktopDocumentUpdateResponseSchema,
  type DesktopDocumentDetail,
  type DesktopDocumentRevision,
  type DesktopDocumentTreeResponse,
} from "@humanthread/workbench-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Menu, Save, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { useDesktopSession } from "../../session/session-provider";
import { DocumentEditor } from "./document-editor";
import {
  documentDetailQueryKey,
  documentRevisionsQueryKey,
  documentTreeQueryKey,
  preserveDocumentConflict,
} from "./document-queries";
import { DocumentRevisions } from "./document-revisions";
import { DocumentTree } from "./document-tree";
import {
  clearDocumentWorkspaceSnapshot,
  clearDocumentWorkspaceSnapshots,
  hasPendingDocumentWorkspaceNavigation,
  shouldRestoreCurrentDocumentWorkspace,
  clearDocumentWorkspaceNavigation,
} from "./document-workspace-state";

function createCommandId(): string {
  const randomPart = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `desktop:document:${randomPart}`;
}

export function DocumentWorkspace(props: {
  detail: DesktopDocumentDetail | null;
  draft: string;
  groups: DesktopDocumentTreeResponse["data"]["groups"];
  revisions: DesktopDocumentRevision[];
  revisionsLoading?: boolean;
  savePending: boolean;
  saveDisabled?: boolean;
  notice?: { kind: "success" | "error"; text: string } | null;
  onDraftChange: (draft: string) => void;
  onSave: () => void;
}) {
  const workspaceScopeKey = props.detail?.projectId ?? "space";
  const documentScopeKey = props.detail ? `${workspaceScopeKey}/${props.detail.id}` : null;
  const shouldRestore = useMemo(
    () => shouldRestoreCurrentDocumentWorkspace(workspaceScopeKey),
    [workspaceScopeKey],
  );
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const workspaceCleanupTimer = useRef<number | null>(null);

  useEffect(() => {
    if (workspaceCleanupTimer.current !== null) {
      window.clearTimeout(workspaceCleanupTimer.current);
      workspaceCleanupTimer.current = null;
    }
    if (!shouldRestore) {
      clearDocumentWorkspaceSnapshot(workspaceScopeKey);
      clearDocumentWorkspaceSnapshots(`${workspaceScopeKey}/`);
    }
    clearDocumentWorkspaceNavigation(workspaceScopeKey);
    return () => {
      const clearWorkspace = () => {
        workspaceCleanupTimer.current = null;
        if (hasPendingDocumentWorkspaceNavigation(workspaceScopeKey)) return;
        clearDocumentWorkspaceSnapshot(workspaceScopeKey);
        clearDocumentWorkspaceSnapshots(`${workspaceScopeKey}/`);
      };
      if (shouldRestore) {
        workspaceCleanupTimer.current = window.setTimeout(clearWorkspace, 0);
      } else {
        clearWorkspace();
      }
    };
  }, [shouldRestore, workspaceScopeKey]);

  useEffect(() => {
    if (!documentScopeKey) return;
    return () => clearDocumentWorkspaceSnapshot(documentScopeKey);
  }, [documentScopeKey]);

  return (
    <div
      className="document-workspace"
      data-directory-open={String(directoryOpen)}
      data-testid="document-workspace"
    >
      <aside className={`document-directory-panel${directoryOpen ? " is-open" : ""}`}>
        {directoryOpen ? (
          <header>
            <strong>目录</strong>
            <button aria-label="关闭文档目录" onClick={() => setDirectoryOpen(false)} title="关闭文档目录" type="button"><X size={16} /></button>
          </header>
        ) : null}
        <div className="document-tree-host" hidden={!directoryOpen}>
          <DocumentTree
            key={workspaceScopeKey}
            groups={props.groups}
            {...(props.detail ? { selectedDocumentId: props.detail.id } : {})}
            workspaceScopeKey={workspaceScopeKey}
          />
        </div>
        {!directoryOpen ? (
          <button
            aria-label="打开文档目录"
            className="document-directory-collapsed"
            onClick={() => setDirectoryOpen(true)}
            title="打开文档目录"
            type="button"
          >
            <Menu size={17} />
          </button>
        ) : null}
      </aside>
      {directoryOpen ? <button aria-label="关闭文档目录" className="document-drawer-backdrop" onClick={() => setDirectoryOpen(false)} type="button" /> : null}
      <main className="document-body-panel">
        {props.detail ? (
          <>
            <header className="document-body-header">
              <button aria-label="打开文档目录" className="document-directory-trigger" onClick={() => setDirectoryOpen(true)} title="打开文档目录" type="button"><Menu size={17} /></button>
              <div>
                <span>{props.detail.projectId ? "项目文档" : "空间文档"} · v{props.detail.version}</span>
                <h1>{props.detail.title}</h1>
                <p>{props.detail.path}</p>
              </div>
              <button
                aria-label={props.savePending ? "保存中" : "保存文档"}
                className="document-save-button"
                disabled={!props.detail.capabilities.edit || props.savePending || props.saveDisabled}
                onClick={props.onSave}
                type="button"
              >
                <Save aria-hidden="true" size={15} />
                <span>{props.savePending ? "保存中" : "保存"}</span>
              </button>
            </header>
            {props.notice ? <p className={`document-save-notice is-${props.notice.kind}`} role={props.notice.kind === "error" ? "alert" : "status"}>{props.notice.text}</p> : null}
            <DocumentEditor
              key={props.detail.id}
              markdown={props.draft}
              onChange={props.onDraftChange}
              readOnly={!props.detail.capabilities.edit}
              documentId={props.detail.id}
              workspaceScopeKey={documentScopeKey ?? props.detail.id}
            />
          </>
        ) : (
          <div className="document-selection-empty">
            <FileText aria-hidden="true" size={22} />
            <strong>选择一篇文档</strong>
            <p>从目录中打开空间文档或项目文档。</p>
          </div>
        )}
      </main>
      {props.detail ? (
        <DocumentRevisions
          currentVersion={props.detail.version}
          revisions={props.revisions}
          {...(props.revisionsLoading === undefined ? {} : { loading: props.revisionsLoading })}
        />
      ) : null}
    </div>
  );
}

export function DocumentPage() {
  const { documentId = "" } = useParams();
  const session = useDesktopSession();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const loaded = useRef<{ id: string; content: string } | null>(null);
  const spaceSearch = session.context
    ? new URLSearchParams({ space: session.context.spaceKey }).toString()
    : "";

  const treeQuery = useQuery({
    enabled: Boolean(session.client && session.context),
    queryKey: session.context
      ? documentTreeQueryKey(session.context)
      : ["desktop", "documents", "tree", "disabled"],
    queryFn: async () => {
      if (!session.client) throw new Error("桌面会话不可用");
      return session.client.request(
        `/api/desktop/documents/tree?${spaceSearch}`,
        desktopDocumentTreeResponseSchema,
      );
    },
  });

  const detailQuery = useQuery({
    enabled: Boolean(documentId && session.client && session.context),
    queryKey: session.context
      ? documentDetailQueryKey(session.context, documentId)
      : ["desktop", "documents", "detail", "disabled"],
    queryFn: async () => {
      if (!session.client) throw new Error("桌面会话不可用");
      return session.client.request(
        `/api/desktop/documents/${encodeURIComponent(documentId)}?${spaceSearch}`,
        desktopDocumentDetailResponseSchema,
      );
    },
  });

  const revisionsQuery = useQuery({
    enabled: Boolean(documentId && session.client && session.context),
    queryKey: session.context
      ? documentRevisionsQueryKey(session.context, documentId)
      : ["desktop", "documents", "revisions", "disabled"],
    queryFn: async () => {
      if (!session.client) throw new Error("桌面会话不可用");
      return session.client.request(
        `/api/desktop/documents/${encodeURIComponent(documentId)}/revisions?${spaceSearch}`,
        desktopDocumentRevisionsResponseSchema,
      );
    },
  });

  const detail = detailQuery.data?.data.detail ?? null;
  useEffect(() => {
    if (!detail) return;
    if (!loaded.current || loaded.current.id !== detail.id || draft === loaded.current.content) {
      setDraft(detail.contentMarkdown);
    }
    loaded.current = { id: detail.id, content: detail.contentMarkdown };
  }, [detail, draft]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!session.client || !detail) throw new Error("文档尚未就绪");
      return session.client.request(
        `/api/desktop/documents/${encodeURIComponent(detail.id)}?${spaceSearch}`,
        desktopDocumentUpdateResponseSchema,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            commandId: createCommandId(),
            expectedVersion: detail.version,
            title: detail.title,
            contentMarkdown: draft,
          }),
        },
      );
    },
    onSuccess: async () => {
      setNotice({ kind: "success", text: "文档已保存并生成新修订。" });
      if (!session.context || !detail) return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: documentDetailQueryKey(session.context, detail.id) }),
        queryClient.invalidateQueries({ queryKey: documentRevisionsQueryKey(session.context, detail.id) }),
        queryClient.invalidateQueries({ queryKey: documentTreeQueryKey(session.context) }),
      ]);
    },
    onError: (error) => {
      const conflict = preserveDocumentConflict(error, draft);
      if (conflict) {
        setDraft(conflict.localDraft);
        setNotice({
          kind: "error",
          text: conflict.currentVersion
            ? `服务器已有较新版本（v${conflict.currentVersion}），本地草稿已保留。`
            : "服务器已有较新版本，本地草稿已保留。",
        });
        return;
      }
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "文档保存失败。" });
    },
  });

  if (treeQuery.isPending || (documentId && detailQuery.isPending)) {
    return <div aria-label="正在加载文档" className="feature-loading-state" />;
  }
  if (treeQuery.isError || detailQuery.isError) {
    const error = treeQuery.error ?? detailQuery.error;
    return <p className="feature-error-state" role="alert">{error?.message ?? "文档加载失败"}</p>;
  }

  return (
    <DocumentWorkspace
      detail={detail}
      draft={draft}
      groups={treeQuery.data?.data.groups ?? []}
      notice={notice}
      onDraftChange={(value) => { setDraft(value); setNotice(null); }}
      onSave={() => saveMutation.mutate()}
      revisions={revisionsQuery.data?.data.revisions ?? []}
      revisionsLoading={revisionsQuery.isPending}
      savePending={saveMutation.isPending}
      saveDisabled={Boolean(detail && draft === detail.contentMarkdown)}
    />
  );
}
