import type { DesktopDocumentRevision } from "@humanthread/workbench-client";
import { ArrowLeft, History, X } from "lucide-react";
import { useState } from "react";

import { DocumentPreview } from "./document-preview";

function revisionTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function DocumentRevisions(props: {
  currentVersion: number;
  revisions: DesktopDocumentRevision[];
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<DesktopDocumentRevision | null>(null);

  return (
    <div className="document-revisions-control" data-open={open}>
      <button
        className="document-revisions-trigger"
        onClick={() => setOpen(true)}
        type="button"
      >
        <History aria-hidden="true" size={15} />
        修订 {props.currentVersion}
      </button>
      {open ? (
        <aside aria-label="修订记录" className="document-revision-region" role="region">
          <header>
            <div>
              {selected ? (
                <button aria-label="返回修订列表" onClick={() => setSelected(null)} title="返回修订列表" type="button"><ArrowLeft size={16} /></button>
              ) : <History aria-hidden="true" size={16} />}
              <strong>{selected ? `版本 ${selected.version}` : "修订记录"}</strong>
            </div>
            <button aria-label="收起修订记录" onClick={() => { setOpen(false); setSelected(null); }} title="收起修订记录" type="button"><X size={16} /></button>
          </header>
          {selected ? (
            <DocumentPreview className="document-revision-preview" markdown={selected.contentMarkdown} />
          ) : (
            <div className="document-revision-list">
              {props.loading ? <p>正在加载修订记录...</p> : props.revisions.length ? props.revisions.map((revision) => (
                <button aria-label={`版本 ${revision.version}`} key={revision.id} onClick={() => setSelected(revision)} type="button">
                  <span><strong>版本 {revision.version}</strong><small>{revision.source}</small></span>
                  <time dateTime={revision.createdAt}>{revisionTime(revision.createdAt)}</time>
                </button>
              )) : <p>暂无可查看的修订记录</p>}
            </div>
          )}
        </aside>
      ) : null}
    </div>
  );
}
