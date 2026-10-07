"use client";

import { markdown } from "@codemirror/lang-markdown";
import { EditorContent, useEditor } from "@tiptap/react";
import {
  Bold,
  Code2,
  Eye,
  Heading2,
  Italic,
  List,
  ListChecks,
  ListOrdered,
  Quote,
  Save,
  SquarePen,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { createTaskCommandId } from "../../../lib/tasks/task-command-id";
import { taskEditorExtensions } from "../../../lib/tasks/task-markdown";
import { DocumentMarkdownRenderer } from "../document-markdown-renderer";

const CodeMirror = dynamic(() => import("@uiw/react-codemirror"), {
  ssr: false,
  loading: () => <div className="h-full min-h-0 bg-[#f6f8fa]" aria-label="Markdown 编辑器加载中" />,
});

export const TASK_EDITOR_MODES = ["rich", "preview", "source"] as const;
export const TASK_SAVE_CONFLICT_MESSAGE = "任务正文已被更新，请保留本地草稿并刷新后合并。";

type TaskEditorMode = (typeof TASK_EDITOR_MODES)[number];

export interface TaskEditorProps {
  taskId: string;
  title: string;
  contentMarkdown: string;
  version: number;
  canEdit: boolean;
  onSaved?(result: { version: number; contentMarkdown: string }): void;
}

interface UpdateTaskResponse {
  ok: boolean;
  result?: { taskId: string; version: number };
  error?: string;
}

function taskDraftKey(taskId: string) {
  return `humanthread:task-draft:${taskId}`;
}

function ModeButton({
  active,
  label,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: ReactNode;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={active
        ? "grid h-8 w-8 place-items-center border border-[#8c959f] bg-white text-[#24292f] first:rounded-l-md last:rounded-r-md"
        : "grid h-8 w-8 place-items-center border-y border-r border-[#d0d7de] bg-[#f6f8fa] text-[#57606a] first:rounded-l-md first:border-l last:rounded-r-md hover:bg-white"}
    >
      {icon}
    </button>
  );
}

function ToolbarButton({ label, active = false, onClick, children }: {
  label: string;
  active?: boolean;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={active
        ? "grid h-8 w-8 place-items-center rounded-md bg-[#dbeafe] text-[#0969da]"
        : "grid h-8 w-8 place-items-center rounded-md text-[#57606a] hover:bg-[#f3f4f6] hover:text-[#24292f]"}
    >
      {children}
    </button>
  );
}

export function TaskEditor({
  taskId,
  title,
  contentMarkdown,
  version: initialVersion,
  canEdit,
  onSaved,
}: TaskEditorProps) {
  const [draft, setDraft] = useState(contentMarkdown);
  const [version, setVersion] = useState(initialVersion);
  const [mode, setMode] = useState<TaskEditorMode>(canEdit ? "rich" : "preview");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const draftRef = useRef(draft);

  const editor = useEditor({
    immediatelyRender: false,
    editable: canEdit,
    extensions: taskEditorExtensions,
    content: draft,
    contentType: "markdown",
    editorProps: {
      attributes: {
        "aria-label": "任务富文本正文",
        class: "min-h-full px-5 py-4 text-[15px] leading-7 outline-none",
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      const next = currentEditor.getMarkdown();
      draftRef.current = next;
      setDraft(next);
    },
  });

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    if (!editor || mode !== "rich") return;
    const current = editor.getMarkdown();
    if (current !== draftRef.current) {
      editor.commands.setContent(draftRef.current, { contentType: "markdown", emitUpdate: false });
    }
  }, [editor, mode]);

  function selectMode(nextMode: TaskEditorMode) {
    setMessage(null);
    setMode(nextMode);
  }

  function updateDraft(value: string) {
    draftRef.current = value;
    setDraft(value);
  }

  async function saveTask() {
    setMessage(null);
    const currentDraft = draftRef.current;
    localStorage.setItem(taskDraftKey(taskId), JSON.stringify({
      title,
      contentMarkdown: currentDraft,
      baseVersion: version,
      savedAt: new Date().toISOString(),
    }));
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          commandId: createTaskCommandId(),
          expectedVersion: version,
          contentMarkdown: currentDraft,
        }),
      });
      const body = await response.json() as UpdateTaskResponse;
      if (!response.ok || !body.ok || !body.result) {
        setMessage(response.status === 409 ? TASK_SAVE_CONFLICT_MESSAGE : (body.error ?? "任务正文保存失败"));
        return;
      }
      setVersion(body.result.version);
      localStorage.removeItem(taskDraftKey(taskId));
      setMessage(`已保存为 v${body.result.version}`);
      onSaved?.({ version: body.result.version, contentMarkdown: currentDraft });
    } catch {
      setMessage("网络异常，本地草稿已保留。稍后可重试保存。");
    }
  }

  if (!draft.trim()) {
    return (
      <section className="grid h-full min-h-0 place-items-center px-5 py-8 text-center" aria-label={`${title}正文`}>
        <p className="text-sm text-[#57606a]">暂无任务正文</p>
      </section>
    );
  }

  if (!canEdit) {
    return (
      <section className="grid h-full min-h-0 overflow-hidden" aria-label={`${title}正文`}>
        <div data-task-editor-scroll className="h-full min-h-0 overflow-y-auto overscroll-contain px-5 py-4">
          <DocumentMarkdownRenderer markdown={draft} />
        </div>
      </section>
    );
  }

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-white" aria-label={`${title}正文编辑器`}>
      <div className="flex min-h-11 shrink-0 items-center justify-between gap-2 border-b border-[#d0d7de] px-3 py-1.5">
        <div className="inline-flex min-w-0 items-center gap-1" aria-label="富文本工具栏">
          {mode === "rich" && editor ? (
            <>
              <ToolbarButton label="粗体" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={16} /></ToolbarButton>
              <ToolbarButton label="斜体" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={16} /></ToolbarButton>
              <ToolbarButton label="二级标题" active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 size={16} /></ToolbarButton>
              <ToolbarButton label="无序列表" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={16} /></ToolbarButton>
              <ToolbarButton label="有序列表" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={16} /></ToolbarButton>
              <ToolbarButton label="任务列表" active={editor.isActive("taskList")} onClick={() => editor.chain().focus().toggleTaskList().run()}><ListChecks size={16} /></ToolbarButton>
              <ToolbarButton label="引用" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote size={16} /></ToolbarButton>
              <ToolbarButton label="代码块" active={editor.isActive("codeBlock")} onClick={() => editor.chain().focus().toggleCodeBlock().run()}><Code2 size={16} /></ToolbarButton>
            </>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="inline-flex" aria-label="任务正文模式">
            <ModeButton active={mode === "rich"} label="富文本" icon={<SquarePen size={16} />} onClick={() => selectMode("rich")} />
            <ModeButton active={mode === "preview"} label="预览" icon={<Eye size={16} />} onClick={() => selectMode("preview")} />
            <ModeButton active={mode === "source"} label="Markdown 源码" icon={<Code2 size={16} />} onClick={() => selectMode("source")} />
          </div>
          <button
            type="button"
            aria-label="保存任务正文"
            title="保存任务正文"
            disabled={isPending}
            onClick={() => startTransition(() => void saveTask())}
            className="grid h-8 w-8 place-items-center rounded-md bg-[#1f883d] text-white hover:bg-[#1a7f37] disabled:opacity-60"
          >
            <Save size={16} />
          </button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 overflow-hidden">
        <div data-task-editor-scroll className="h-full min-h-0 overflow-y-auto overscroll-contain">
          {mode === "rich" ? <EditorContent editor={editor} className="min-h-full" /> : null}
          {mode === "preview" ? <div className="mx-auto max-w-[860px] px-5 py-4"><DocumentMarkdownRenderer markdown={draft} /></div> : null}
          {mode === "source" ? (
            <CodeMirror
              aria-label="任务 Markdown 正文"
              value={draft}
              height="100%"
              extensions={[markdown()]}
              onChange={updateDraft}
              basicSetup={{ lineNumbers: true, foldGutter: true }}
              theme="light"
              className="h-full min-h-[280px] text-sm"
            />
          ) : null}
        </div>
      </div>

      <div className="flex min-h-9 shrink-0 items-center justify-between gap-3 border-t border-[#d0d7de] bg-[#f6f8fa] px-3 text-xs text-[#57606a]">
        <span className="truncate">Markdown · v{version}</span>
        {message ? <span role={message.startsWith("已保存") ? "status" : "alert"}>{message}</span> : null}
      </div>
    </section>
  );
}
