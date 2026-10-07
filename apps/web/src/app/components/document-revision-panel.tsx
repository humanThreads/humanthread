"use client";

import {
  ArrowLeft,
  Clock3,
  History,
  PanelRightClose,
  X,
} from "lucide-react";
import type { WorkbenchDocumentRevision } from "../../lib/workbench/workbench-documents";
import { DocumentMarkdownRenderer } from "./document-markdown-renderer";
import { formatWorkbenchDateTime } from "./workbench-sections";

interface DocumentRevisionPanelProps {
  revisions: WorkbenchDocumentRevision[];
  open: boolean;
  mobileOpen: boolean;
  selectedRevisionId: string | null;
  onOpenChange(open: boolean): void;
  onMobileOpenChange(open: boolean): void;
  onSelectRevision(revisionId: string | null): void;
}

function RevisionPanelBody({
  revisions,
  selectedRevisionId,
  onCollapse,
  onCloseMobile,
  onSelectRevision,
}: {
  revisions: WorkbenchDocumentRevision[];
  selectedRevisionId: string | null;
  onCollapse?: () => void;
  onCloseMobile?: () => void;
  onSelectRevision(revisionId: string | null): void;
}) {
  const selectedRevision = revisions.find((revision) => revision.id === selectedRevisionId) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#fbfcfd]">
      <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-[#d0d7de] px-3">
        {selectedRevision ? (
          <button
            type="button"
            onClick={() => onSelectRevision(null)}
            aria-label="返回修订列表"
            title="返回修订列表"
            className="grid h-8 w-8 place-items-center rounded-md text-[#57606a] hover:bg-[#f0f1f2]"
          >
            <ArrowLeft size={16} />
          </button>
        ) : <History size={16} className="text-[#57606a]" />}
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold">
            {selectedRevision ? `版本 v${selectedRevision.version}` : "修订记录"}
          </h3>
          {selectedRevision ? <p className="text-[11px] text-[#57606a]">只读历史版本</p> : null}
        </div>
        {onCollapse ? (
          <button
            type="button"
            onClick={onCollapse}
            aria-label="收起修订记录"
            title="收起修订记录"
            className="grid h-8 w-8 place-items-center rounded-md text-[#57606a] hover:bg-[#f0f1f2]"
          >
            <PanelRightClose size={16} />
          </button>
        ) : null}
        {onCloseMobile ? (
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="关闭修订记录"
            title="关闭修订记录"
            className="grid h-8 w-8 place-items-center rounded-md text-[#57606a] hover:bg-[#f0f1f2]"
          >
            <X size={17} />
          </button>
        ) : null}
      </header>

      {selectedRevision ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 border-b border-[#d8dee4] px-4 py-3 text-xs text-[#57606a]">
            <div className="flex items-center gap-1.5"><Clock3 size={13} />{formatWorkbenchDateTime(selectedRevision.createdAt)}</div>
            <div className="mt-1">来源：{selectedRevision.source}</div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-white px-5 py-5">
            <DocumentMarkdownRenderer markdown={selectedRevision.contentMarkdown} />
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {revisions.length > 0 ? (
            <div className="divide-y divide-[#d8dee4]">
              {revisions.map((revision) => (
                <button
                  type="button"
                  key={revision.id}
                  onClick={() => onSelectRevision(revision.id)}
                  aria-label={`查看版本 v${revision.version}`}
                  className="block w-full px-4 py-3 text-left hover:bg-[#f0f6fc] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#0969da]"
                >
                  <div className="text-sm font-semibold text-[#24292f]">v{revision.version}</div>
                  <div className="mt-1 text-xs text-[#57606a]">{revision.source} · {formatWorkbenchDateTime(revision.createdAt)}</div>
                </button>
              ))}
            </div>
          ) : <div className="px-4 py-8 text-center text-xs text-[#8c959f]">暂无修订记录</div>}
        </div>
      )}
    </div>
  );
}

export function DocumentRevisionPanel({
  revisions,
  open,
  mobileOpen,
  selectedRevisionId,
  onOpenChange,
  onMobileOpenChange,
  onSelectRevision,
}: DocumentRevisionPanelProps) {
  return (
    <>
      {open ? (
        <aside className="hidden h-full min-h-0 overflow-hidden border-l border-[#d0d7de] xl:block" aria-label="修订记录侧栏">
          <RevisionPanelBody
            revisions={revisions}
            selectedRevisionId={selectedRevisionId}
            onCollapse={() => onOpenChange(false)}
            onSelectRevision={onSelectRevision}
          />
        </aside>
      ) : null}

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 xl:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-[#1f2328]/45"
            aria-label="关闭修订记录遮罩"
            onClick={() => onMobileOpenChange(false)}
          />
          <aside className="absolute inset-y-0 right-0 w-[min(94vw,520px)] border-l border-[#d0d7de] bg-white shadow-xl" aria-label="移动端修订记录">
            <RevisionPanelBody
              revisions={revisions}
              selectedRevisionId={selectedRevisionId}
              onCloseMobile={() => onMobileOpenChange(false)}
              onSelectRevision={onSelectRevision}
            />
          </aside>
        </div>
      ) : null}
    </>
  );
}
