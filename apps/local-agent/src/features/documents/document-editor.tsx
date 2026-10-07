import {
  Bold,
  Braces,
  Columns2,
  Eye,
  Heading2,
  Italic,
  Link as LinkIcon,
  List,
  PenLine,
} from "lucide-react";
import { useRef, useState } from "react";

import { DocumentPreview } from "./document-preview";
import {
  readDocumentWorkspaceSnapshot,
  shouldRestoreCurrentDocumentWorkspace,
  writeDocumentWorkspaceSnapshot,
  type DocumentWorkspaceSnapshotStorage,
} from "./document-workspace-state";

type EditorMode = "edit" | "source" | "split" | "preview";

const MODES: Array<{ id: EditorMode; label: string; icon: typeof PenLine }> = [
  { id: "edit", label: "编辑", icon: PenLine },
  { id: "source", label: "源码", icon: Braces },
  { id: "split", label: "分栏", icon: Columns2 },
  { id: "preview", label: "预览", icon: Eye },
];

export function DocumentEditor(props: {
  markdown: string;
  onChange: (markdown: string) => void;
  readOnly: boolean;
  workspaceScopeKey?: string;
  documentId?: string;
}) {
  const scopeKey = props.workspaceScopeKey ?? props.documentId ?? "default";
  const [mode, setMode] = useState<EditorMode>(() => {
    if (typeof window === "undefined") return getInitialDocumentEditorMode();
    return getRestoredDocumentEditorMode(
      scopeKey,
      window.sessionStorage,
      shouldRestoreCurrentDocumentWorkspace(),
    );
  });
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function format(prefix: string, suffix = prefix, placeholder = "文本") {
    if (props.readOnly) return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = props.markdown.slice(start, end) || placeholder;
    const next = `${props.markdown.slice(0, start)}${prefix}${selected}${suffix}${props.markdown.slice(end)}`;
    props.onChange(next);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
    });
  }

  const showsSource = mode !== "preview";
  const showsPreview = mode === "split" || mode === "preview";

  return (
    <section className="document-editor" aria-label="文档编辑器">
      <div className="document-editor-toolbar">
        <div className="document-mode-tabs" role="tablist" aria-label="文档显示模式">
          {MODES.map((item) => {
            const Icon = item.icon;
            return (
              <button
                aria-label={item.label}
                aria-selected={mode === item.id}
                key={item.id}
                onClick={() => { setMode(item.id); writeDocumentWorkspaceSnapshot(scopeKey, { mode: item.id }); }}
                role="tab"
                type="button"
              >
                <Icon aria-hidden="true" size={14} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
        <div className="document-format-tools" aria-label="Markdown 格式">
          <button aria-label="二级标题" disabled={props.readOnly} onClick={() => format("## ", "", "标题")} title="二级标题" type="button"><Heading2 size={15} /></button>
          <button aria-label="加粗" disabled={props.readOnly} onClick={() => format("**", "**")} title="加粗" type="button"><Bold size={15} /></button>
          <button aria-label="斜体" disabled={props.readOnly} onClick={() => format("_", "_")} title="斜体" type="button"><Italic size={15} /></button>
          <button aria-label="项目列表" disabled={props.readOnly} onClick={() => format("- ", "", "列表项")} title="项目列表" type="button"><List size={15} /></button>
          <button aria-label="插入链接" disabled={props.readOnly} onClick={() => format("[", "](https://)", "链接文字")} title="插入链接" type="button"><LinkIcon size={15} /></button>
        </div>
      </div>
      <div className={`document-editor-canvas document-editor-${mode}`}>
        {showsSource ? (
          <textarea
            aria-label="Markdown 源码"
            className={mode === "edit" ? "is-compose" : ""}
            onChange={(event) => props.onChange(event.target.value)}
            readOnly={props.readOnly}
            ref={textareaRef}
            spellCheck={mode === "edit"}
            value={props.markdown}
          />
        ) : null}
        {showsPreview ? <DocumentPreview markdown={props.markdown} /> : null}
      </div>
    </section>
  );
}

export function getInitialDocumentEditorMode(): EditorMode {
  return "preview";
}

export function getRestoredDocumentEditorMode(
  scopeKey: string,
  storage: DocumentWorkspaceSnapshotStorage,
  shouldRestore: boolean,
): EditorMode {
  return readDocumentWorkspaceSnapshot(scopeKey, storage, shouldRestore)?.mode
    ?? getInitialDocumentEditorMode();
}
