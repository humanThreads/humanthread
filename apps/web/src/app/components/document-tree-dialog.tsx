"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, FilePlus2, FolderPlus, Move, Pencil, RotateCcw, Trash2, X } from "lucide-react";
import { useId, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  buildDocumentPath,
  documentTitleToFilename,
  listLegalDirectoryTargets,
  validateDirectoryName,
  validateDocumentDraft,
  type DocumentTreeCommand,
  type DocumentTreeCommandValues,
  type DocumentTreeData,
  type DocumentTreeInteractionError,
} from "./document-tree-interactions";

interface DocumentTreeDialogProps {
  command: DocumentTreeCommand;
  tree: DocumentTreeData;
  pending: boolean;
  error: DocumentTreeInteractionError | null;
  onSubmit(values: DocumentTreeCommandValues): Promise<void>;
  onClose(): void;
}

interface DialogMeta {
  title: string;
  description: string;
  submitLabel: string;
  pendingLabel: string;
  destructive?: boolean;
  icon: ReactNode;
}

function getDialogMeta(command: DocumentTreeCommand): DialogMeta {
  switch (command.type) {
    case "create-directory":
      return { title: "新建文件夹", description: "在当前文档容器中创建可嵌套的文件夹。", submitLabel: "创建文件夹", pendingLabel: "创建中", icon: <FolderPlus size={18} /> };
    case "create-document":
      return { title: "新建文档", description: "创建 Markdown 文档并进入正文工作区。", submitLabel: "创建并打开", pendingLabel: "创建中", icon: <FilePlus2 size={18} /> };
    case "rename-directory":
      return { title: "重命名文件夹", description: "后代文件夹和文档路径会同步更新。", submitLabel: "保存名称", pendingLabel: "保存中", icon: <Pencil size={18} /> };
    case "move-directory":
      return { title: "移动文件夹", description: "只能移动到当前空间或项目内的合法位置。", submitLabel: "确认移动", pendingLabel: "移动中", icon: <Move size={18} /> };
    case "delete-directory":
      return { title: "删除空文件夹", description: "仅空文件夹可删除，不会级联删除内容。", submitLabel: "确认删除", pendingLabel: "删除中", destructive: true, icon: <Trash2 size={18} /> };
    case "move-document":
      return { title: "移动文档", description: "选择当前空间或项目内的目标位置。", submitLabel: "确认移动", pendingLabel: "移动中", icon: <Move size={18} /> };
    case "trash-document":
      return { title: "移入回收站", description: "文档可从回收站恢复，不会立即永久删除。", submitLabel: "移入回收站", pendingLabel: "处理中", destructive: true, icon: <Trash2 size={18} /> };
    case "restore-document":
      return { title: "恢复文档", description: "优先恢复到删除前的位置。", submitLabel: "恢复文档", pendingLabel: "恢复中", icon: <RotateCcw size={18} /> };
    default:
      return { title: "文档目录操作", description: "确认当前操作。", submitLabel: "确认", pendingLabel: "处理中", icon: <AlertTriangle size={18} /> };
  }
}

function findDirectory(tree: DocumentTreeData, groupKey: string, directoryId: string | null | undefined) {
  if (!directoryId) return null;
  return tree.groups.find((group) => group.key === groupKey)?.directories.find((item) => item.id === directoryId) ?? null;
}

function findDocument(tree: DocumentTreeData, command: DocumentTreeCommand) {
  if (!("documentId" in command)) return null;
  const groupDocument = tree.groups.find((group) => group.key === command.groupKey)?.documents.find((item) => item.id === command.documentId);
  return groupDocument ?? tree.trash.find((item) => item.id === command.documentId) ?? null;
}

function FieldError({ id, children }: { id: string; children: string | undefined }) {
  return children ? <span id={id} className="text-xs font-medium text-[#cf222e]">{children}</span> : null;
}

export function DocumentTreeDialog({
  command,
  tree,
  pending,
  error,
  onSubmit,
  onClose,
}: DocumentTreeDialogProps) {
  const meta = getDialogMeta(command);
  const group = tree.groups.find((item) => item.key === command.groupKey);
  const sourceDirectoryId = "directoryId" in command ? command.directoryId : null;
  const sourceDirectory = findDirectory(tree, command.groupKey, sourceDirectoryId);
  const targetDirectoryId = command.type === "create-directory"
    ? command.parentId
    : command.type === "create-document"
      ? command.directoryId
      : null;
  const targetDirectory = findDirectory(tree, command.groupKey, targetDirectoryId);
  const document = findDocument(tree, command);
  const [name, setName] = useState(command.type === "rename-directory" ? sourceDirectory?.name ?? "" : "");
  const [title, setTitle] = useState("");
  const [filename, setFilename] = useState(command.type === "restore-document" ? documentTitleToFilename(document?.title ?? "untitled") : "");
  const [filenameEdited, setFilenameEdited] = useState(false);
  const [directoryId, setDirectoryId] = useState<string | null>(
    command.type === "move-directory"
      ? sourceDirectory?.parentId ?? null
      : command.type === "move-document"
        ? document?.directoryId ?? null
        : null,
  );
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; title?: string; filename?: string }>({});
  const nameErrorId = useId();
  const titleErrorId = useId();
  const filenameErrorId = useId();
  const legalTargets = useMemo(() => group
    ? listLegalDirectoryTargets({
        group,
        ...(command.type === "move-directory" ? { sourceDirectoryId: command.directoryId } : {}),
      })
    : [], [command, group]);
  const selectedDirectory = findDirectory(tree, command.groupKey, directoryId);
  const contextDirectory = targetDirectory ?? sourceDirectory;
  const contextLabel = `${group?.label ?? "文档空间"} / ${contextDirectory?.path ?? "根目录"}`;
  const showDocumentFields = command.type === "create-document";
  const showNameField = command.type === "create-directory" || command.type === "rename-directory";
  const showMoveField = command.type === "move-directory" || command.type === "move-document" || (command.type === "restore-document" && error?.restoreConflict);
  const showRestoreFilename = command.type === "restore-document" && error?.restoreConflict;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (showNameField) {
      const nameError = validateDirectoryName(name);
      if (nameError) {
        setFieldErrors({ name: nameError });
        return;
      }
    }
    if (showDocumentFields || showRestoreFilename) {
      const errors = validateDocumentDraft({
        title: showDocumentFields ? title : document?.title ?? "恢复文档",
        filename,
      });
      if (Object.keys(errors).length > 0) {
        setFieldErrors(errors);
        return;
      }
    }
    setFieldErrors({});
    await onSubmit({
      ...(showNameField ? { name } : {}),
      ...(showDocumentFields ? { title, filename } : {}),
      ...(showMoveField ? { directoryId } : {}),
      ...(showRestoreFilename ? { filename } : {}),
    });
  }

  const previewDirectory = showRestoreFilename ? selectedDirectory : targetDirectory;
  const preview = buildDocumentPath({ directoryPath: previewDirectory?.path ?? null, filename });

  return (
    <Dialog.Root open onOpenChange={(open) => {
      if (!open && !pending) onClose();
    }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[#1f2328]/45" />
        <Dialog.Content
          aria-busy={pending}
          onEscapeKeyDown={(event) => pending && event.preventDefault()}
          onPointerDownOutside={(event) => pending && event.preventDefault()}
          className="fixed inset-x-0 bottom-0 z-50 max-h-[92vh] overflow-y-auto border border-[#d0d7de] bg-white shadow-[0_24px_60px_rgba(31,35,40,0.24)] outline-none sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:w-[min(92vw,560px)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg"
        >
          <form onSubmit={(event) => void submit(event)}>
            <div className="flex items-start gap-3 border-b border-[#d0d7de] px-5 py-4">
              <div className={meta.destructive
                ? "grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[#ffebe9] text-[#cf222e]"
                : "grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[#ddf4ff] text-[#0550ae]"}
              >
                {meta.icon}
              </div>
              <div className="min-w-0 flex-1">
                <Dialog.Title className="text-base font-semibold text-[#24292f]">{meta.title}</Dialog.Title>
                <Dialog.Description className="mt-1 text-sm leading-5 text-[#57606a]">{meta.description}</Dialog.Description>
              </div>
              <button type="button" disabled={pending} onClick={onClose} className="grid h-8 w-8 place-items-center rounded-md text-[#57606a] hover:bg-[#f6f8fa] disabled:opacity-50" aria-label="关闭弹窗"><X size={17} /></button>
            </div>

            <div className="grid gap-4 px-5 py-5">
              <div className="rounded-md border border-[#b6d7f8] bg-[#f0f7ff] px-3 py-2 text-xs font-medium text-[#0550ae]">
                {contextLabel}
              </div>
              {error ? <div role="alert" className="rounded-md border border-[#f1aeb5] bg-[#fff5f5] px-3 py-2 text-sm text-[#cf222e]">{error.message}</div> : null}

              {showNameField ? (
                <label className="grid gap-1.5 text-sm font-semibold text-[#24292f]">
                  文件夹名称
                  <input
                    autoFocus
                    aria-label="文件夹名称"
                    value={name}
                    onChange={(event) => { setName(event.target.value); setFieldErrors({}); }}
                    aria-describedby={fieldErrors.name ? nameErrorId : undefined}
                    className="h-10 rounded-md border border-[#8c959f] px-3 font-normal outline-none focus:border-[#0969da] focus:ring-4 focus:ring-[#0969da]/10"
                  />
                  <FieldError id={nameErrorId}>{fieldErrors.name}</FieldError>
                </label>
              ) : null}

              {showDocumentFields ? (
                <>
                  <label className="grid gap-1.5 text-sm font-semibold text-[#24292f]">
                    文档标题
                    <input
                      autoFocus
                      aria-label="文档标题"
                      value={title}
                      onChange={(event) => {
                        const nextTitle = event.target.value;
                        setTitle(nextTitle);
                        if (!filenameEdited) setFilename(documentTitleToFilename(nextTitle));
                        setFieldErrors({});
                      }}
                      aria-describedby={fieldErrors.title ? titleErrorId : undefined}
                      className="h-10 rounded-md border border-[#8c959f] px-3 font-normal outline-none focus:border-[#0969da] focus:ring-4 focus:ring-[#0969da]/10"
                    />
                    <FieldError id={titleErrorId}>{fieldErrors.title}</FieldError>
                  </label>
                  <label className="grid gap-1.5 text-sm font-semibold text-[#24292f]">
                    文件名
                    <input
                      aria-label="文件名"
                      value={filename}
                      onChange={(event) => { setFilename(event.target.value); setFilenameEdited(true); setFieldErrors({}); }}
                      aria-describedby={fieldErrors.filename ? filenameErrorId : undefined}
                      className="h-10 rounded-md border border-[#8c959f] px-3 font-mono text-sm font-normal outline-none focus:border-[#0969da] focus:ring-4 focus:ring-[#0969da]/10"
                    />
                    <FieldError id={filenameErrorId}>{fieldErrors.filename}</FieldError>
                  </label>
                  <div className="rounded-md border border-[#d0d7de] bg-[#f6f8fa] px-3 py-2 font-mono text-xs text-[#57606a]">{preview}</div>
                </>
              ) : null}

              {showMoveField ? (
                <label className="grid gap-1.5 text-sm font-semibold text-[#24292f]">
                  {showRestoreFilename ? "恢复到" : "目标位置"}
                  <select
                    aria-label={showRestoreFilename ? "恢复到" : "目标位置"}
                    value={directoryId ?? ""}
                    onChange={(event) => setDirectoryId(event.target.value || null)}
                    className="h-10 rounded-md border border-[#8c959f] bg-white px-3 font-normal outline-none focus:border-[#0969da] focus:ring-4 focus:ring-[#0969da]/10"
                  >
                    {legalTargets.map((target) => <option key={target.id ?? "root"} value={target.id ?? ""}>{target.label}</option>)}
                  </select>
                </label>
              ) : null}

              {showRestoreFilename ? (
                <>
                  <label className="grid gap-1.5 text-sm font-semibold text-[#24292f]">
                    文件名
                    <input
                      aria-label="文件名"
                      value={filename}
                      onChange={(event) => { setFilename(event.target.value); setFieldErrors({}); }}
                      aria-describedby={filenameErrorId}
                      className="h-10 rounded-md border border-[#8c959f] px-3 font-mono text-sm font-normal outline-none focus:border-[#0969da] focus:ring-4 focus:ring-[#0969da]/10"
                    />
                    <FieldError id={filenameErrorId}>{fieldErrors.filename ?? (error?.field === "filename" ? error.message : undefined)}</FieldError>
                  </label>
                  <div className="rounded-md border border-[#d0d7de] bg-[#f6f8fa] px-3 py-2 font-mono text-xs text-[#57606a]">{preview}</div>
                </>
              ) : null}

              {command.type === "delete-directory" ? <p className="text-sm text-[#57606a]">确认删除“{sourceDirectory?.name ?? "当前文件夹"}”？文件夹必须为空。</p> : null}
              {command.type === "trash-document" ? <p className="text-sm text-[#57606a]">“{document?.title ?? "当前文档"}”将移入回收站，并保留恢复信息。</p> : null}
              {command.type === "restore-document" && !showRestoreFilename ? <p className="text-sm text-[#57606a]">“{document?.title ?? "当前文档"}”将恢复到删除前的位置。</p> : null}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-[#d0d7de] bg-[#fbfcfd] px-5 py-3">
              <button type="button" disabled={pending} onClick={onClose} className="h-9 rounded-md border border-[#d0d7de] bg-white px-3 text-sm font-semibold text-[#24292f] hover:bg-[#f6f8fa] disabled:opacity-50">取消</button>
              <button type="submit" disabled={pending} className={meta.destructive
                ? "h-9 rounded-md bg-[#cf222e] px-3 text-sm font-semibold text-white hover:bg-[#a40e26] disabled:opacity-50"
                : "h-9 rounded-md bg-[#1f883d] px-3 text-sm font-semibold text-white hover:bg-[#1a7f37] disabled:opacity-50"}
              >
                {pending ? meta.pendingLabel : meta.submitLabel}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
