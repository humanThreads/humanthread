import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import { TableKit } from "@tiptap/extension-table";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { Markdown, MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";

export type TaskEditorContent = ReturnType<MarkdownManager["parse"]>;

export const taskEditorExtensions = [
  StarterKit.configure({ link: false }),
  Link.configure({ openOnClick: false }),
  Image,
  TableKit.configure({ table: { resizable: false } }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Markdown.configure({ indentation: { style: "space", size: 2 } }),
];

function createTaskMarkdownManager() {
  return new MarkdownManager({ extensions: taskEditorExtensions });
}

export function markdownToTaskEditorContent(markdown: string): TaskEditorContent {
  return createTaskMarkdownManager().parse(markdown);
}

export function taskEditorContentToMarkdown(content: TaskEditorContent): string {
  return createTaskMarkdownManager().serialize(content);
}
