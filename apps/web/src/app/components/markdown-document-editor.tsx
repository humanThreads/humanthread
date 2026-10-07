"use client";

import { markdown } from "@codemirror/lang-markdown";
import { animate } from "animejs";
import { Check, Eye, FileUp, Pencil, Save } from "lucide-react";
import dynamic from "next/dynamic";
import { useRef, useState, useTransition, type ReactNode } from "react";
import { DocumentMarkdownRenderer } from "./document-markdown-renderer";
import { DocumentHtmlPreview } from "./document-html-preview";
import {
  readDocumentWorkspaceSnapshot,
  shouldRestoreCurrentDocumentWorkspace,
  writeDocumentWorkspaceSnapshot,
  type DocumentWorkspaceSnapshotStorage,
} from "./document-workspace-state";

const CodeMirror = dynamic(() => import("@uiw/react-codemirror"), {
  ssr: false,
  loading: () => <div className="h-full min-h-0 bg-[#f6f8fa]" aria-label="Markdown 编辑器加载中" />,
});

export const DOCUMENT_SAVE_CONFLICT_MESSAGE = "文档已被更新，请刷新后合并。";
export const DOCUMENT_EDITOR_MODES = ["edit", "view"] as const;
type DocumentEditorMode = (typeof DOCUMENT_EDITOR_MODES)[number];

export interface MarkdownDocumentEditorDocument {
  id: string;
  projectId?: string | null;
  title: string;
  path: string;
  contentMarkdown: string;
  version: number;
  format?: "markdown" | "htm";
}

interface MarkdownDocumentEditorProps {
  document: MarkdownDocumentEditorDocument;
  canWrite?: boolean;
  workspaceActions?: ReactNode;
  workspaceScopeKey?: string;
}

interface UpdateDocumentResponse {
  ok: boolean;
  document?: { id: string; version: number };
  error?: string;
}

interface AttachmentUploadResponse {
  ok: boolean;
  attachment?: {
    originalName: string;
    mimeType: string;
    markdownUrl: string;
  };
  error?: string;
}

export function buildAttachmentMarkdown(attachment: {
  originalName: string;
  mimeType: string;
  markdownUrl: string;
}) {
  return attachment.mimeType.startsWith("image/")
    ? `![${attachment.originalName}](${attachment.markdownUrl})`
    : `[${attachment.originalName}](${attachment.markdownUrl})`;
}

export function shouldAttachDiagramPreview(attachment: { originalName: string; mimeType: string }) {
  return attachment.mimeType === "application/vnd.xmind.workbook"
    || attachment.mimeType === "application/vnd.ms-visio.drawing"
    || /\.(?:xmind|vsdx|vsd)$/iu.test(attachment.originalName);
}

export function getInitialDocumentEditorMode(): DocumentEditorMode {
  return "view";
}

export function getRestoredDocumentEditorMode(
  scopeKey: string,
  storage: DocumentWorkspaceSnapshotStorage,
  shouldRestore: boolean,
): DocumentEditorMode {
  const mode = readDocumentWorkspaceSnapshot(scopeKey, storage, shouldRestore)?.mode;
  return mode === "edit" || mode === "view"
    ? mode
    : getInitialDocumentEditorMode();
}

function ModeButton({
  mode,
  activeMode,
  label,
  icon,
  onSelect,
}: {
  mode: DocumentEditorMode;
  activeMode: DocumentEditorMode;
  label: string;
  icon: React.ReactNode;
  onSelect(mode: DocumentEditorMode): void;
}) {
  const active = mode === activeMode;
  return (
    <button
      type="button"
      onClick={() => onSelect(mode)}
      aria-pressed={active}
      title={label}
      className={active
        ? "inline-flex h-8 items-center gap-1.5 border border-[#8c959f] bg-white px-2.5 text-xs font-semibold text-[#24292f] first:rounded-l-md last:rounded-r-md"
        : "inline-flex h-8 items-center gap-1.5 border-y border-r border-[#d0d7de] bg-[#f6f8fa] px-2.5 text-xs font-semibold text-[#57606a] first:rounded-l-md first:border-l last:rounded-r-md hover:bg-white"}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

export function MarkdownDocumentEditor({
  document,
  canWrite = true,
  workspaceActions,
  workspaceScopeKey = document.id,
}: MarkdownDocumentEditorProps) {
  const [title, setTitle] = useState(document.title);
  const [contentMarkdown, setContentMarkdown] = useState(document.contentMarkdown);
  const isHtmlDocument = document.format === "htm" || document.path.toLowerCase().endsWith(".htm");
  const [version, setVersion] = useState(document.version);
  const [mode, setMode] = useState<DocumentEditorMode>(() => {
    if (typeof window === "undefined") return getInitialDocumentEditorMode();
    return getRestoredDocumentEditorMode(
      workspaceScopeKey,
      window.sessionStorage,
      shouldRestoreCurrentDocumentWorkspace(),
    );
  });
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messageRef = useRef<HTMLDivElement>(null);
  function selectMode(nextMode: DocumentEditorMode) {
    setMode(nextMode);
    writeDocumentWorkspaceSnapshot(workspaceScopeKey, { mode: nextMode });
  }

  function showMessage(value: string) {
    setMessage(value);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    requestAnimationFrame(() => {
      if (messageRef.current) {
        animate(messageRef.current, { opacity: [0, 1], translateY: [4, 0], duration: 220 });
      }
    });
  }

  async function saveDocument() {
    setMessage(null);
    const response = await fetch(`/api/documents/${encodeURIComponent(document.id)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion: version, title, contentMarkdown }),
    });
    const body = (await response.json()) as UpdateDocumentResponse;
    if (!response.ok || !body.ok || !body.document) {
      showMessage(response.status === 409 ? DOCUMENT_SAVE_CONFLICT_MESSAGE : (body.error ?? "文档保存失败"));
      return;
    }
    setVersion(body.document.version);
    selectMode("view");
    showMessage(`已保存为 v${body.document.version}`);
  }

  async function uploadAttachment(file: File) {
    const formData = new FormData();
    formData.set("file", file);
    const response = await fetch(
      `/api/documents/${encodeURIComponent(document.id)}/attachments`,
      { method: "POST", body: formData },
    );
    const body = (await response.json()) as AttachmentUploadResponse;
    if (!response.ok || !body.ok || !body.attachment) {
      showMessage(body.error ?? "附件上传失败");
      return;
    }
    const markdownValue = buildAttachmentMarkdown(body.attachment);
    setContentMarkdown((current) => `${current}${current.endsWith("\n") || !current ? "" : "\n\n"}${markdownValue}\n`);
    if (shouldAttachDiagramPreview(body.attachment)) selectMode("edit");
    showMessage(`已插入 ${body.attachment.originalName}`);
  }

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white">
      <div className="flex min-h-[52px] min-w-0 flex-wrap items-center gap-3 border-b border-[#d0d7de] px-4 py-2">
        <input
          value={title}
          disabled={!canWrite}
          onChange={(event) => setTitle(event.target.value)}
          aria-label="文档标题"
          className="min-w-0 flex-[1_1_180px] border-0 bg-transparent text-lg font-semibold outline-none disabled:text-[#24292f]"
        />
        {workspaceActions ? <div className="inline-flex shrink-0 items-center gap-1">{workspaceActions}</div> : null}
        <div className="inline-flex" aria-label="编辑器模式">
          <ModeButton mode="view" activeMode={mode} label="查看" icon={<Eye size={14} />} onSelect={selectMode} />
          {canWrite ? <ModeButton mode="edit" activeMode={mode} label="编辑" icon={<Pencil size={14} />} onSelect={selectMode} /> : null}
        </div>
        {canWrite ? (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,text/html,application/pdf,text/plain,text/csv,text/markdown,application/json,application/zip,application/vnd.xmind.workbook,application/vnd.ms-visio.drawing,.xmind,.vsdx,.vsd,.docx,.xlsx,.pptx"
              className="hidden"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) void uploadAttachment(file);
                event.currentTarget.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="上传图片或附件"
              aria-label="上传图片或附件"
              className="grid h-8 w-8 place-items-center rounded-md border border-[#d0d7de] text-[#57606a] hover:bg-[#f6f8fa]"
            >
              <FileUp size={16} />
            </button>
            {mode === "edit" ? <button
              type="button"
              disabled={isPending}
              onClick={() => startTransition(() => void saveDocument())}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#1f883d] px-3 text-xs font-semibold text-white hover:bg-[#1a7f37] disabled:opacity-60"
            >
              <Save size={14} />
              {isPending ? "保存中" : "保存"}
            </button> : null}
          </>
        ) : null}
      </div>

      <div className="grid min-h-0 flex-1 overflow-hidden">
        {mode === "edit" ? (
          <div className="h-full min-h-0 min-w-0 overflow-hidden">
            <CodeMirror
              value={contentMarkdown}
              height="100%"
              extensions={[markdown()]}
              onChange={setContentMarkdown}
              basicSetup={{ lineNumbers: true, foldGutter: true }}
              theme="light"
              className="h-full text-sm"
            />
          </div>
        ) : null}
        {mode === "view" ? (
          <div className="h-full min-h-0 min-w-0 overflow-y-auto overscroll-contain px-6 py-5 lg:px-10">
            <div className="mx-auto max-w-[860px]">
              {isHtmlDocument ? <DocumentHtmlPreview title={title} html={contentMarkdown} /> : <DocumentMarkdownRenderer markdown={contentMarkdown} />}
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex min-h-9 min-w-0 items-center justify-between gap-3 border-t border-[#d0d7de] bg-[#f6f8fa] px-4 text-xs text-[#57606a]">
        <span className="min-w-0 truncate" title={document.path}>{document.path}</span>
        <span className="inline-flex shrink-0 items-center gap-1.5">
          {message ? <Check size={13} /> : null}
          <span ref={messageRef}>{message ?? `当前版本 v${version}`}</span>
        </span>
      </div>
    </section>
  );
}
