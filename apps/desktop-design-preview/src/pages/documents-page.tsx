import {
  desktopDocumentDetailResponseSchema,
  desktopDocumentRevisionsResponseSchema,
  desktopDocumentTreeResponseSchema,
} from "@humanthread/workbench-client";
import { ChevronDown, ChevronRight, FileText, PanelLeftClose, PanelLeftOpen, PanelRightOpen, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { usePreviewReadModel } from "../session/preview-session";
import { MarkdownPreview } from "../ui/markdown-preview";
import { AsyncState, PageHeader, StatusPill, SurfaceHeader } from "../ui/primitives";

export function DocumentsPage() {
  const [treeOpen, setTreeOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [revisionsOpen, setRevisionsOpen] = useState(false);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const treeQuery = usePreviewReadModel({
    domain: "document-tree",
    endpoint: "/api/desktop/documents/tree",
    schema: desktopDocumentTreeResponseSchema,
  });
  const detailQuery = usePreviewReadModel({
    domain: "document-detail",
    endpoint: `/api/desktop/documents/${encodeURIComponent(selectedDocumentId ?? "inactive")}`,
    parameters: selectedDocumentId ? { documentId: selectedDocumentId } : {},
    enabled: Boolean(selectedDocumentId),
    schema: desktopDocumentDetailResponseSchema,
  });
  const revisionsQuery = usePreviewReadModel({
    domain: "document-revisions",
    endpoint: `/api/desktop/documents/${encodeURIComponent(selectedDocumentId ?? "inactive")}/revisions`,
    parameters: selectedDocumentId ? { documentId: selectedDocumentId } : {},
    enabled: Boolean(selectedDocumentId) && revisionsOpen,
    schema: desktopDocumentRevisionsResponseSchema,
  });
  const tree = treeQuery.data?.data;

  useEffect(() => {
    if (selectedDocumentId || !tree) return;
    const firstDocument = tree.groups.flatMap((group) => group.documents)[0];
    if (firstDocument) setSelectedDocumentId(firstDocument.id);
  }, [selectedDocumentId, tree]);

  return (
    <div className="page-stack document-page" data-tree-open={String(treeOpen)} data-revisions-open={String(revisionsOpen)}>
      <PageHeader
        actions={<StatusPill tone="warning">只读预览</StatusPill>}
        description="目录、正文和版本信息均可独立收起，目录在页面内局部滚动。"
        title="文档"
      />
      <section className="document-workspace">
        <AsyncState
          error={treeQuery.error instanceof Error ? treeQuery.error.message : null}
          label="正在加载文档"
          onRetry={() => void treeQuery.refetch()}
          status={treeQuery.isPending ? "pending" : treeQuery.isError ? "error" : "success"}
        >
          {tree ? (
            <>
              <aside className="document-tree-panel" data-open={String(treeOpen)}>
                {treeOpen ? (
                  <nav aria-label="文档目录" className="document-tree-scroll">
                    <header className="document-panel-header">
                      <strong>目录</strong>
                      <button aria-label="收起文档目录" className="icon-button" onClick={() => setTreeOpen(false)} type="button"><PanelLeftClose aria-hidden="true" size={16} /></button>
                    </header>
                    {tree.groups.map((group) => (
                      <section key={group.key}>
                        <header><strong>{group.label}</strong><span>{group.documents.length}</span></header>
                        <div className="document-directory-label">{group.directories[0]?.name}</div>
                        {group.documents.map((document) => (
                          <button aria-current={selectedDocumentId === document.id ? "page" : undefined} key={document.id} onClick={() => setSelectedDocumentId(document.id)} type="button">
                            <FileText aria-hidden="true" size={14} />
                            <span>{document.title}</span>
                          </button>
                        ))}
                      </section>
                    ))}
                    <section className="trash-section">
                      <button aria-expanded={trashOpen} aria-label="回收站" onClick={() => setTrashOpen((current) => !current)} type="button">
                        {trashOpen ? <ChevronDown aria-hidden="true" size={14} /> : <ChevronRight aria-hidden="true" size={14} />}
                        <Trash2 aria-hidden="true" size={14} />
                        <span>回收站</span>
                        <em>{tree.trash.length}</em>
                      </button>
                      {trashOpen ? tree.trash.map((item) => <div className="trash-item" key={item.id}>{item.title}</div>) : null}
                    </section>
                  </nav>
                ) : (
                  <button aria-label="展开文档目录" className="document-collapse-rail" onClick={() => setTreeOpen(true)} type="button"><PanelLeftOpen aria-hidden="true" size={16} /><span>目录</span></button>
                )}
              </aside>

              <main className="document-content-panel">
                <SurfaceHeader
                  actions={(
                    <button aria-expanded={revisionsOpen} className="secondary-button" onClick={() => setRevisionsOpen((current) => !current)} type="button">
                      <PanelRightOpen aria-hidden="true" size={14} />版本信息
                    </button>
                  )}
                  description={detailQuery.data?.data.detail.path ?? "选择目录中的文档"}
                  title={detailQuery.data?.data.detail.title ?? "文档正文"}
                />
                <AsyncState
                  empty={!selectedDocumentId && tree.groups.every((group) => group.documents.length === 0)}
                  emptyDescription="当前空间还没有文档，正式客户端会在这里提供创建入口。"
                  emptyTitle="暂无文档"
                  error={detailQuery.error instanceof Error ? detailQuery.error.message : null}
                  label="正在加载文档正文"
                  onRetry={() => void detailQuery.refetch()}
                  status={detailQuery.isPending && selectedDocumentId ? "pending" : detailQuery.isError ? "error" : "success"}
                >
                  {detailQuery.data ? (
                    <article className="document-content">
                      <div className="document-meta">
                        <StatusPill tone="neutral">v{detailQuery.data.data.detail.version}</StatusPill>
                        <span>更新于 {new Date(detailQuery.data.data.detail.updatedAt).toLocaleString("zh-CN")}</span>
                      </div>
                      <MarkdownPreview markdown={detailQuery.data.data.detail.contentMarkdown} />
                    </article>
                  ) : null}
                </AsyncState>
              </main>

              {revisionsOpen ? (
                <aside aria-label="文档版本信息" className="document-revisions-panel">
                  <header className="document-panel-header">
                    <strong>版本信息</strong>
                    <button aria-label="关闭版本信息" className="icon-button" onClick={() => setRevisionsOpen(false)} type="button"><X aria-hidden="true" size={16} /></button>
                  </header>
                  <AsyncState
                    error={revisionsQuery.error instanceof Error ? revisionsQuery.error.message : null}
                    label="正在加载版本信息"
                    onRetry={() => void revisionsQuery.refetch()}
                    status={revisionsQuery.isPending ? "pending" : revisionsQuery.isError ? "error" : "success"}
                  >
                    {revisionsQuery.data ? (
                      <ol className="revision-list">
                        {revisionsQuery.data.data.revisions.map((revision) => (
                          <li key={revision.id}>
                            <div><strong>v{revision.version}</strong><StatusPill tone="neutral">{revision.source}</StatusPill></div>
                            <span>{new Date(revision.createdAt).toLocaleString("zh-CN")}</span>
                          </li>
                        ))}
                      </ol>
                    ) : null}
                  </AsyncState>
                </aside>
              ) : null}
            </>
          ) : null}
        </AsyncState>
      </section>
    </div>
  );
}
