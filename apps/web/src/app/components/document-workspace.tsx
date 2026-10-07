"use client";

import { History, Menu, PanelLeftOpen, PanelRightOpen, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { WorkbenchDocumentRevision } from "../../lib/workbench/workbench-documents";
import { DocumentTree } from "./document-tree";
import { DocumentProjectSwitcher } from "./document-project-switcher";
import { DocumentRevisionPanel } from "./document-revision-panel";
import { MarkdownDocumentEditor, type MarkdownDocumentEditorDocument } from "./markdown-document-editor";
import {
  clearDocumentWorkspaceSnapshot,
  clearDocumentWorkspaceSnapshots,
  hasPendingDocumentWorkspaceNavigation,
  shouldRestoreCurrentDocumentWorkspace,
  clearDocumentWorkspaceNavigation,
} from "./document-workspace-state";

interface DocumentWorkspaceProps {
  tree: Parameters<typeof DocumentTree>[0];
  document?: MarkdownDocumentEditorDocument;
  canWrite?: boolean;
  revisions?: WorkbenchDocumentRevision[];
  projects?: Array<{ id: string; name: string }>;
  selectedProjectId?: string;
}

function useServerTree(serverTree: DocumentWorkspaceProps["tree"]) {
  const [tree, setTree] = useState(serverTree);
  const [trackedTree, setTrackedTree] = useState(serverTree);
  if (trackedTree !== serverTree) {
    setTrackedTree(serverTree);
    setTree(serverTree);
  }
  return [tree, setTree] as const;
}

export function DocumentWorkspace({ tree: serverTree, document: initialDocument, canWrite = false, revisions: initialRevisions = [], projects = [], selectedProjectId }: DocumentWorkspaceProps) {
  const [tree, setTree] = useServerTree(serverTree);
  const [document, setDocument] = useState(initialDocument);
  const [revisions, setRevisions] = useState(initialRevisions);
  const [currentProjectId, setCurrentProjectId] = useState<string | undefined>(selectedProjectId ?? initialDocument?.projectId ?? undefined);
  const [loading, setLoading] = useState(false);
  const initialDocumentId = initialDocument?.id;
  // Keep the server snapshot stable while a same-document selection is being loaded locally.
  const initialDocumentSnapshot = useMemo(
    () => ({ document: initialDocument, revisions: initialRevisions }),
    // The snapshot intentionally changes only when the server document identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [initialDocumentId],
  );
  const workspaceScopeKey = document?.projectId ? `project:${document.projectId}` : currentProjectId ? `project:${currentProjectId}` : `space:${tree.spaceId}`;
  const documentScopeKey = document ? `${workspaceScopeKey}/${document.id}` : null;
  const shouldRestore = useMemo(
    () => shouldRestoreCurrentDocumentWorkspace(workspaceScopeKey),
    [workspaceScopeKey],
  );
  const [treeOpen, setTreeOpen] = useState(false);
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  const workspaceCleanupTimer = useRef<number | null>(null);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionMobileOpen, setRevisionMobileOpen] = useState(false);
  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(null);
  const selectedRevision = revisions.find((revision) => revision.id === selectedRevisionId) ?? null;
  const documentCanWrite = document
    ? (tree.groups.find((group) => group.key === (document.projectId ? `project:${document.projectId}` : `space:${tree.spaceId}`))?.canWrite ?? canWrite)
    : canWrite;
  const workspaceColumns = treeCollapsed
    ? revisionOpen
      ? selectedRevision
        ? "lg:grid-cols-[minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_420px]"
        : "lg:grid-cols-[minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_240px]"
      : document
        ? "lg:grid-cols-[minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_44px]"
        : "lg:grid-cols-[minmax(0,1fr)]"
    : revisionOpen
      ? selectedRevision
        ? "lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_420px]"
        : "lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_240px]"
      : document
        ? "lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_44px]"
        : "lg:grid-cols-[280px_minmax(0,1fr)]";

  async function selectDocument(documentId: string) {
    setLoading(true);
    try {
      const [documentResponse, revisionsResponse] = await Promise.all([
        fetch(`/api/documents/${encodeURIComponent(documentId)}`),
        fetch(`/api/documents/${encodeURIComponent(documentId)}/revisions`),
      ]);
      const documentBody = await documentResponse.json() as { ok?: boolean; document?: MarkdownDocumentEditorDocument };
      const revisionsBody = await revisionsResponse.json() as { ok?: boolean; revisions?: WorkbenchDocumentRevision[] };
      if (!documentResponse.ok || !documentBody.ok || !documentBody.document) throw new Error("文档加载失败");
      setDocument(documentBody.document);
      setRevisions(revisionsBody.revisions ?? []);
      setCurrentProjectId(documentBody.document.projectId ?? undefined);
      window.history.replaceState({}, "", `/documents/${encodeURIComponent(documentId)}`);
    } catch {
      setDocument(undefined);
      setRevisions([]);
    } finally {
      setLoading(false);
    }
  }

  async function selectProject(projectId: string | null) {
    setLoading(true);
    try {
      const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
      const response = await fetch(`/api/spaces/${encodeURIComponent(tree.spaceId)}/document-tree${query}`);
      const body = await response.json() as { ok?: boolean; tree?: typeof tree };
      if (!response.ok || !body.ok || !body.tree) throw new Error("项目目录加载失败");
      setTree(body.tree);
      setDocument(undefined);
      setRevisions([]);
      setCurrentProjectId(projectId ?? undefined);
      window.history.replaceState({}, "", projectId ? `/documents?project=${encodeURIComponent(projectId)}` : "/documents");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      const nextDocument = initialDocumentSnapshot.document;
      setDocument(nextDocument);
      setRevisions(nextDocument ? initialDocumentSnapshot.revisions : []);
      setCurrentProjectId(nextDocument?.projectId ?? undefined);
    });
    return () => { cancelled = true; };
  }, [initialDocumentSnapshot]);

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

  const projectSwitcher = <DocumentProjectSwitcher projects={projects} {...(currentProjectId ? { selectedProjectId: currentProjectId } : {})} companyDocumentsHref="/documents" onProjectChange={(projectId) => void selectProject(projectId)} />;

  return (
    <div className="grid h-full min-h-0 min-w-0 grid-rows-[minmax(0,1fr)]">
      <div className={`relative grid h-full min-h-0 items-stretch overflow-hidden bg-white ${workspaceColumns}`}>
      <aside key={workspaceScopeKey} className={treeCollapsed ? "hidden h-full min-h-full self-stretch overflow-hidden bg-[#f6f8fa] lg:hidden" : "hidden h-full min-h-full self-stretch flex-col overflow-hidden border-r border-[#d0d7de] bg-[#f6f8fa] lg:flex"}><DocumentTree {...tree} workspaceScopeKey={workspaceScopeKey} projectSwitcher={projectSwitcher} onCollapse={() => setTreeCollapsed(true)} {...(document ? { activeDocumentId: document.id } : {})} onDocumentSelect={(id) => void selectDocument(id)} /></aside>
      <div className="flex h-full min-h-0 min-w-0 overflow-hidden">
        <button type="button" onClick={() => setTreeOpen(true)} className="absolute left-3 top-3 z-20 grid h-8 w-8 place-items-center rounded-md border border-[#d0d7de] bg-white lg:hidden" aria-label="打开文档目录"><Menu size={16} /></button>
        {treeCollapsed ? <button type="button" onClick={() => setTreeCollapsed(false)} className="absolute left-3 top-3 z-20 hidden h-8 w-8 place-items-center rounded-md border border-[#d0d7de] bg-white text-[#57606a] hover:bg-[#f6f8fa] lg:grid" aria-label="展开文档目录" title="展开文档目录"><PanelLeftOpen size={16} /></button> : null}
        {document ? <MarkdownDocumentEditor key={document.id} document={document} canWrite={documentCanWrite} workspaceScopeKey={documentScopeKey ?? document.id} workspaceActions={<>
          <button type="button" onClick={() => setRevisionMobileOpen(true)} className="grid h-8 w-8 place-items-center rounded-md border border-[#d0d7de] bg-white text-[#57606a] hover:bg-[#f6f8fa] xl:hidden" aria-label="打开修订记录" title="打开修订记录"><History size={16} /></button>
        </>} /> : <div className="grid h-full min-h-0 flex-1 place-items-center px-6 text-center"><div>{loading ? <p className="text-sm text-[#57606a]">加载中...</p> : <><FileState /><h2 className="mt-4 text-lg font-semibold">选择或创建文档</h2><p className="mt-2 text-sm text-[#57606a]">从左侧目录打开空间文档或项目文档。</p></>}</div></div>}
      </div>
      <DocumentRevisionPanel revisions={revisions} open={revisionOpen} mobileOpen={revisionMobileOpen} selectedRevisionId={selectedRevisionId} onOpenChange={setRevisionOpen} onMobileOpenChange={setRevisionMobileOpen} onSelectRevision={setSelectedRevisionId} />
      {document && !revisionOpen ? <aside className="hidden h-full min-h-0 items-start justify-center border-l border-[#d0d7de] bg-[#fbfcfd] pt-3 xl:flex" aria-label="修订记录展开栏"><button type="button" onClick={() => setRevisionOpen(true)} className="grid h-8 w-8 place-items-center rounded-md text-[#57606a] hover:bg-[#f0f1f2]" aria-label="打开修订记录" title="打开修订记录"><PanelRightOpen size={16} /></button></aside> : null}
      {treeOpen ? <div className="fixed inset-0 z-50 lg:hidden"><button type="button" className="absolute inset-0 bg-[#1f2328]/45" aria-label="关闭文档目录" onClick={() => setTreeOpen(false)} /><aside className="absolute inset-y-0 left-0 w-[min(88vw,340px)] bg-white shadow-xl"><button type="button" onClick={() => setTreeOpen(false)} className="absolute right-2 top-2 z-10 grid h-8 w-8 place-items-center rounded-md hover:bg-[#f3f4f6]" aria-label="关闭文档目录"><X size={17} /></button><DocumentTree key={workspaceScopeKey} {...tree} workspaceScopeKey={workspaceScopeKey} projectSwitcher={projectSwitcher} {...(document ? { activeDocumentId: document.id } : {})} onDocumentSelect={(id) => { setTreeOpen(false); void selectDocument(id); }} /></aside></div> : null}
      </div>
    </div>
  );
}

function FileState() {
  return <div className="mx-auto grid h-12 w-12 place-items-center rounded-md border border-[#d0d7de] bg-[#f6f8fa] text-2xl text-[#57606a]">#</div>;
}
