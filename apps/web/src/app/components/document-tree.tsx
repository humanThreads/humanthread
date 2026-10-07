"use client";

import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { animate } from "animejs";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Move,
  PanelLeftClose,
  Pencil,
  RotateCcw,
  Trash2,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import type {
  WorkbenchDocumentDirectoryItem,
  WorkbenchDocumentTreeGroup,
  WorkbenchDocumentTreeItem,
} from "../../lib/workbench/workbench-documents";
import { DocumentTreeDialog } from "./document-tree-dialog";
import { DocumentPermissionDialog } from "./document-permission-dialog";
import {
  buildDocumentTreeRequest,
  mapDocumentTreeError,
  type DocumentTreeCommand,
  type DocumentTreeCommandValues,
  type DocumentTreeData,
  type DocumentTreeInteractionError,
} from "./document-tree-interactions";
import {
  DocumentTreeItemMenu,
  type DocumentTreeMenuCommand,
} from "./document-tree-item-menu";
import {
  handoffDocumentWorkspaceNavigation,
  readDocumentWorkspaceSnapshot,
  shouldRestoreCurrentDocumentWorkspace,
  writeDocumentWorkspaceSnapshot,
} from "./document-workspace-state";

export const DOCUMENT_TREE_GROUP_LABELS = ["空间文档", "项目文档", "回收站"] as const;

interface DocumentTreeProps {
  spaceId: string;
  workspaceScopeKey?: string;
  groups: WorkbenchDocumentTreeGroup[];
  trash: WorkbenchDocumentTreeItem[];
  activeDocumentId?: string;
  onDocumentSelect?: (documentId: string) => void;
  projectSwitcher?: ReactNode;
  onCollapse?: () => void;
}

interface CommandResponse {
  ok?: boolean;
  error?: string;
  document?: { id?: string };
}

type DocumentNavigationHandler = (group: WorkbenchDocumentTreeGroup, targetPathname: string) => void;

function isPrimaryDocumentNavigation(event: MouseEvent<HTMLAnchorElement>) {
  return !event.defaultPrevented
    && event.button === 0
    && !event.metaKey
    && !event.ctrlKey
    && !event.shiftKey
    && !event.altKey
    && (!event.currentTarget.target || event.currentTarget.target === "_self");
}

function HeaderButton({ label, children, onClick }: { label: string; children: ReactNode; onClick(): void }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="grid h-8 w-8 shrink-0 place-items-center rounded text-[#57606a] hover:bg-[#eaeef2] hover:text-[#24292f]"
    >
      {children}
    </button>
  );
}

function DraggableRow({ id, groupKey, type, enabled, children }: {
  id: string;
  groupKey: string;
  type: "directory" | "document";
  enabled: boolean;
  children: ReactNode;
}) {
  if (!enabled) return children;
  return <EnabledDraggableRow id={id} groupKey={groupKey} type={type}>{children}</EnabledDraggableRow>;
}

function EnabledDraggableRow({ id, groupKey, type, children }: {
  id: string;
  groupKey: string;
  type: "directory" | "document";
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `${type}:${id}`,
    data: { id, groupKey, type },
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        opacity: isDragging ? 0.55 : 1,
      }}
    >
      {children}
    </div>
  );
}

function directoryCommands(input: {
  directory: WorkbenchDocumentDirectoryItem;
  groupKey: string;
  siblingIndex: number;
  siblingCount: number;
}): DocumentTreeMenuCommand[] {
  const { directory, groupKey, siblingIndex, siblingCount } = input;
  return [
    { command: { type: "create-directory", groupKey, parentId: directory.id }, label: "新建子文件夹", icon: <FolderPlus size={14} /> },
    { command: { type: "create-document", groupKey, directoryId: directory.id }, label: "在此新建文档", icon: <FilePlus2 size={14} /> },
    { command: { type: "rename-directory", groupKey, directoryId: directory.id }, label: "重命名", icon: <Pencil size={14} /> },
    { command: { type: "move-directory", groupKey, directoryId: directory.id }, label: "移动", icon: <Move size={14} /> },
    { command: { type: "reorder-directory", groupKey, directoryId: directory.id, direction: "up" }, label: "上移", icon: <ArrowUp size={14} />, disabled: siblingIndex === 0 },
    { command: { type: "reorder-directory", groupKey, directoryId: directory.id, direction: "down" }, label: "下移", icon: <ArrowDown size={14} />, disabled: siblingIndex === siblingCount - 1 },
    { command: { type: "delete-directory", groupKey, directoryId: directory.id }, label: "删除空文件夹", icon: <Trash2 size={14} />, destructive: true },
    { command: { type: "manage-permission", groupKey, targetId: directory.id, targetType: "directory" }, label: "授权", icon: <ShieldCheck size={14} /> },
  ];
}

function documentCommands(input: {
  document: WorkbenchDocumentTreeItem;
  groupKey: string;
  siblingIndex: number;
  siblingCount: number;
}): DocumentTreeMenuCommand[] {
  const { document, groupKey, siblingIndex, siblingCount } = input;
  return [
    { command: { type: "move-document", groupKey, documentId: document.id }, label: "移动", icon: <Move size={14} /> },
    { command: { type: "reorder-document", groupKey, documentId: document.id, direction: "up" }, label: "上移", icon: <ArrowUp size={14} />, disabled: siblingIndex === 0 },
    { command: { type: "reorder-document", groupKey, documentId: document.id, direction: "down" }, label: "下移", icon: <ArrowDown size={14} />, disabled: siblingIndex === siblingCount - 1 },
    { command: { type: "trash-document", groupKey, documentId: document.id }, label: "移入回收站", icon: <Trash2 size={14} />, destructive: true },
    { command: { type: "manage-permission", groupKey, targetId: document.id, targetType: "document" }, label: "授权", icon: <ShieldCheck size={14} /> },
  ];
}

function DirectoryNode({
  directory,
  group,
  documents,
  directories,
  activeDocumentId,
  depth,
  siblingIndex,
  siblingCount,
  onCommand,
  onDocumentNavigate,
  onDocumentSelect,
  expandedDirectoryIds,
  onToggleDirectory,
}: {
  directory: WorkbenchDocumentDirectoryItem;
  group: WorkbenchDocumentTreeGroup;
  documents: WorkbenchDocumentTreeItem[];
  directories: WorkbenchDocumentDirectoryItem[];
  activeDocumentId?: string;
  depth: number;
  siblingIndex: number;
  siblingCount: number;
  onCommand(command: DocumentTreeCommand): void;
  onDocumentNavigate: DocumentNavigationHandler;
  onDocumentSelect?: (documentId: string) => void;
  expandedDirectoryIds: Set<string>;
  onToggleDirectory(id: string): void;
}) {
  const open = expandedDirectoryIds.has(directory.id);
  const contentRef = useRef<HTMLDivElement>(null);
  const { setNodeRef, isOver } = useDroppable({
    id: `drop:${directory.id}`,
    data: { directoryId: directory.id, groupKey: group.key },
    disabled: !group.canWrite,
  });
  const children = directories.filter((item) => item.parentId === directory.id);
  const childDocuments = documents.filter((item) => item.directoryId === directory.id);

  function toggle() {
    onToggleDirectory(directory.id);
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches && contentRef.current) {
      animate(contentRef.current, { opacity: [0.4, 1], duration: 180 });
    }
  }

  return (
    <div ref={setNodeRef} role="treeitem" aria-expanded={open} aria-selected={false} className={isOver ? "bg-[#ddf4ff]" : undefined}>
      <DraggableRow id={directory.id} groupKey={group.key} type="directory" enabled={group.canWrite}>
        <div className="group flex h-8 items-center gap-1 px-2 text-sm" style={{ paddingLeft: 8 + depth * 14 }}>
          <button type="button" onClick={toggle} className="grid h-6 w-6 shrink-0 place-items-center text-[#57606a]" aria-label={open ? "收起目录" : "展开目录"}>
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          {open ? <FolderOpen size={15} className="shrink-0 text-[#bf8700]" /> : <Folder size={15} className="shrink-0 text-[#bf8700]" />}
          <span className="min-w-0 flex-1 truncate font-medium">{directory.name}</span>
          {(group.canManage ?? group.canWrite) ? (
            <DocumentTreeItemMenu
              item={{ id: directory.id, label: directory.name }}
              commands={directoryCommands({ directory, groupKey: group.key, siblingIndex, siblingCount })}
              onCommand={onCommand}
            />
          ) : null}
        </div>
      </DraggableRow>
      {open ? (
        <div ref={contentRef}>
          {children.map((child, index) => (
            <DirectoryNode
              key={child.id}
              directory={child}
              group={group}
              directories={directories}
              documents={documents}
              {...(activeDocumentId ? { activeDocumentId } : {})}
              depth={depth + 1}
              siblingIndex={index}
              siblingCount={children.length}
              onCommand={onCommand}
              onDocumentNavigate={onDocumentNavigate}
              {...(onDocumentSelect ? { onDocumentSelect } : {})}
              expandedDirectoryIds={expandedDirectoryIds}
              onToggleDirectory={onToggleDirectory}
            />
          ))}
          {childDocuments.map((document, index) => (
            <DocumentNode
              key={document.id}
              document={document}
              group={group}
              active={document.id === activeDocumentId}
              depth={depth + 1}
              siblingIndex={index}
              siblingCount={childDocuments.length}
              onCommand={onCommand}
              onDocumentNavigate={onDocumentNavigate}
              {...(onDocumentSelect ? { onDocumentSelect } : {})}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DocumentNode({ document, group, active, depth, siblingIndex, siblingCount, onCommand, onDocumentNavigate, onDocumentSelect }: {
  document: WorkbenchDocumentTreeItem;
  group: WorkbenchDocumentTreeGroup;
  active: boolean;
  depth: number;
  siblingIndex: number;
  siblingCount: number;
  onCommand(command: DocumentTreeCommand): void;
  onDocumentNavigate: DocumentNavigationHandler;
  onDocumentSelect?: (documentId: string) => void;
}) {
  return (
    <DraggableRow id={document.id} groupKey={group.key} type="document" enabled={group.canWrite}>
      <div
        className={active
          ? "group flex h-8 items-center gap-2 bg-[#ddf4ff] px-2 text-sm text-[#0969da]"
          : "group flex h-8 items-center gap-2 px-2 text-sm text-[#24292f] hover:bg-[#f3f4f6]"}
        style={{ paddingLeft: 14 + depth * 14 }}
      >
        <FileText size={14} className="shrink-0" />
        <Link
          href={`/documents/${document.id}`}
          className="min-w-0 flex-1 truncate"
          onClick={(event) => {
            if (isPrimaryDocumentNavigation(event)) {
              if (onDocumentSelect) {
                event.preventDefault();
                onDocumentSelect(document.id);
              } else onDocumentNavigate(group, `/documents/${document.id}`);
            }
          }}
        >{document.title}</Link>
        {(group.canManage ?? group.canWrite) ? (
          <DocumentTreeItemMenu
            item={{ id: document.id, label: document.title }}
            commands={documentCommands({ document, groupKey: group.key, siblingIndex, siblingCount })}
            onCommand={onCommand}
          />
        ) : null}
      </div>
    </DraggableRow>
  );
}

function successMessage(command: DocumentTreeCommand) {
  switch (command.type) {
    case "create-directory": return "文件夹已创建";
    case "create-document": return "文档已创建";
    case "rename-directory": return "文件夹已重命名";
    case "move-directory": return "文件夹已移动";
    case "delete-directory": return "文件夹已删除";
    case "move-document": return "文档已移动";
    case "trash-document": return "文档已移入回收站";
    case "restore-document": return "文档已恢复";
    case "reorder-directory": return "文件夹顺序已更新";
    case "reorder-document": return "文档顺序已更新";
    case "manage-permission": return "权限设置已更新";
  }
}

function opensDialog(command: DocumentTreeCommand) {
  return command.type !== "reorder-directory" && command.type !== "reorder-document";
}

export function DocumentTree({ spaceId, workspaceScopeKey = `space:${spaceId}`, groups, trash, activeDocumentId, onDocumentSelect, projectSwitcher, onCollapse }: DocumentTreeProps) {
  const router = useRouter();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const tree: DocumentTreeData = { spaceId, groups, trash };
  const visibleDirectoryIds = useMemo(
    () => new Set(groups.flatMap((group) => group.directories.map((directory) => directory.id))),
    [groups],
  );
  const [command, setCommand] = useState<DocumentTreeCommand | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [dialogError, setDialogError] = useState<DocumentTreeInteractionError | null>(null);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const shouldRestore = useMemo(
    () => shouldRestoreCurrentDocumentWorkspace(workspaceScopeKey),
    [workspaceScopeKey],
  );
  const [storedExpandedDirectoryIds, setStoredExpandedDirectoryIds] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    const snapshot = readDocumentWorkspaceSnapshot(workspaceScopeKey, window.sessionStorage, shouldRestore);
    return new Set(snapshot?.expandedDirectoryIds ?? []);
  });
  const expandedDirectoryIds = useMemo(
    () => new Set([...storedExpandedDirectoryIds].filter((id) => visibleDirectoryIds.has(id))),
    [storedExpandedDirectoryIds, visibleDirectoryIds],
  );

  useEffect(() => {
    if (shouldRestore && expandedDirectoryIds.size !== storedExpandedDirectoryIds.size) {
      writeDocumentWorkspaceSnapshot(workspaceScopeKey, { expandedDirectoryIds: [...expandedDirectoryIds] });
    }
  }, [expandedDirectoryIds, shouldRestore, storedExpandedDirectoryIds, workspaceScopeKey]);

  function toggleDirectory(id: string) {
    setStoredExpandedDirectoryIds((current) => {
      const next = new Set([...current].filter((currentId) => visibleDirectoryIds.has(currentId)));
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeDocumentWorkspaceSnapshot(workspaceScopeKey, { expandedDirectoryIds: [...next] });
      return next;
    });
  }

  function recordDocumentNavigation(group: WorkbenchDocumentTreeGroup, targetPathname: string) {
    const targetScopeKey = group.projectId ? `project:${group.projectId}` : `space:${group.spaceId}`;
    const isSpaceWorkspace = workspaceScopeKey === "space" || workspaceScopeKey.startsWith("space:");
    if (workspaceScopeKey !== targetScopeKey && !isSpaceWorkspace) return;
    handoffDocumentWorkspaceNavigation(workspaceScopeKey, targetScopeKey, targetPathname);
  }

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  function selectCommand(nextCommand: DocumentTreeCommand) {
    setDialogError(null);
    setTreeError(null);
    if (nextCommand.type === "manage-permission" || opensDialog(nextCommand)) {
      setCommand(nextCommand);
    } else {
      void executeCommand(nextCommand, {}, "tree");
    }
  }

  async function executeCommand(
    nextCommand: DocumentTreeCommand,
    values: DocumentTreeCommandValues,
    errorSurface: "dialog" | "tree",
  ) {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setDialogError(null);
    setTreeError(null);
    try {
      const request = buildDocumentTreeRequest({ command: nextCommand, values, tree });
      const response = await fetch(request.path, request.init);
      const body = await response.json().catch(() => ({ ok: false, error: "Invalid response" })) as CommandResponse;
      if (!response.ok || !body.ok) throw new Error(body.error ?? "Document tree request failed");

      setToast(successMessage(nextCommand));
      setCommand(null);
      if (nextCommand.type === "create-document" && body.document?.id) {
        router.push(`/documents/${body.document.id}`);
      } else if (nextCommand.type === "trash-document" && nextCommand.documentId === activeDocumentId) {
        router.push("/documents");
      } else {
        router.refresh();
      }
    } catch (caught) {
      const mapped = mapDocumentTreeError(caught instanceof Error ? caught.message : "Network request failed");
      if (errorSurface === "dialog") {
        setDialogError(mapped);
        setCommand(nextCommand);
      } else {
        setTreeError(mapped.message);
      }
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  async function onDragEnd(event: DragEndEvent) {
    const active = event.active.data.current as { id: string; groupKey: string; type: "directory" | "document" } | undefined;
    const over = event.over?.data.current as { directoryId: string | null; groupKey: string } | undefined;
    if (!active || !over) return;
    if (active.groupKey !== over.groupKey) {
      setTreeError("目录和文档只能在同一空间或项目内移动。");
      return;
    }
    const nextCommand: DocumentTreeCommand = active.type === "directory"
      ? { type: "move-directory", groupKey: active.groupKey, directoryId: active.id }
      : { type: "move-document", groupKey: active.groupKey, documentId: active.id };
    await executeCommand(nextCommand, { directoryId: over.directoryId }, "tree");
  }

  return (
    <DndContext sensors={sensors} onDragEnd={(event) => void onDragEnd(event)}>
      <nav className="relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-[#f6f8fa]" aria-label="文档目录">
        <div className="shrink-0 border-b border-[#d0d7de] px-3 py-2">
          <div className="flex min-h-7 items-center justify-between gap-2 text-sm font-semibold">
            <span>文档目录</span>
            {onCollapse ? <HeaderButton label="收起文档目录" onClick={onCollapse}><PanelLeftClose size={14} /></HeaderButton> : null}
          </div>
          {projectSwitcher ? <div className="mt-1 min-w-0">{projectSwitcher}</div> : null}
        </div>
        {treeError ? <div role="alert" className="border-b border-[#f1b4b4] bg-[#ffebe9] px-3 py-2 text-xs text-[#cf222e]">{treeError}</div> : null}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-2">
          {groups.map((group, groupIndex) => {
            const rootDirectories = group.directories.filter((item) => !item.parentId);
            const rootDocuments = group.documents.filter((item) => !item.directoryId);
            return (
              <DocumentTreeGroupSection
                key={group.key}
                group={group}
                groupIndex={groupIndex}
                rootDirectories={rootDirectories}
                rootDocuments={rootDocuments}
                {...(activeDocumentId ? { activeDocumentId } : {})}
                onCommand={selectCommand}
                onDocumentNavigate={recordDocumentNavigation}
                {...(onDocumentSelect ? { onDocumentSelect } : {})}
                expandedDirectoryIds={expandedDirectoryIds}
                onToggleDirectory={toggleDirectory}
              />
            );
          })}
          <section className="border-t border-[#d0d7de] pt-2">
            <button type="button" aria-expanded={trashOpen} aria-label={trashOpen ? "收起回收站" : "展开回收站"} onClick={() => setTrashOpen((value) => !value)} className="flex h-8 w-full items-center gap-2 px-3 text-left text-xs font-semibold uppercase text-[#57606a] hover:bg-[#eef1f4]">
              {trashOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <Trash2 size={14} />
              <span className="min-w-0 flex-1 truncate">回收站</span>
              <span className="text-xs font-medium normal-case text-[#8c959f]">{trash.length}</span>
            </button>
            {trashOpen ? <div className="pb-1">
              {trash.map((document) => {
                const group = groups.find((item) => item.key === document.groupKey);
                return (
                  <div key={document.id} className="group flex h-8 items-center gap-2 px-4 text-sm text-[#57606a]">
                    <FileText size={14} className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{document.title}</span>
                    {group?.canWrite ? (
                      <DocumentTreeItemMenu
                        item={{ id: document.id, label: document.title }}
                        commands={[{
                          command: { type: "restore-document", groupKey: document.groupKey, documentId: document.id },
                          label: "恢复文档",
                          icon: <RotateCcw size={14} />,
                        }]}
                        onCommand={selectCommand}
                      />
                    ) : null}
                  </div>
                );
              })}
              {trash.length === 0 ? <div className="px-4 py-2 text-xs text-[#8c959f]">回收站为空</div> : null}
            </div> : null}
          </section>
        </div>
        {toast ? <div role="status" className="absolute inset-x-3 bottom-3 z-20 rounded-md border border-[#7ee787] bg-[#dafbe1] px-3 py-2 text-xs font-medium text-[#116329] shadow-lg">{toast}</div> : null}
      </nav>
      {command && command.type !== "manage-permission" ? (
      <DocumentTreeDialog
          key={JSON.stringify(command)}
          command={command}
          tree={tree}
          pending={pending}
          error={dialogError}
          onClose={() => {
            if (!pendingRef.current) {
              setCommand(null);
              setDialogError(null);
            }
          }}
          onSubmit={(values) => executeCommand(command, values, "dialog")}
      />
      ) : null}
      {command?.type === "manage-permission" ? <DocumentPermissionDialog open targetId={command.targetId} targetType={command.targetType} spaceId={spaceId} onClose={() => setCommand(null)} /> : null}
    </DndContext>
  );
}

function DocumentTreeGroupSection({ group, groupIndex, rootDirectories, rootDocuments, activeDocumentId, onCommand, onDocumentNavigate, onDocumentSelect, expandedDirectoryIds, onToggleDirectory }: {
  group: WorkbenchDocumentTreeGroup;
  groupIndex: number;
  rootDirectories: WorkbenchDocumentDirectoryItem[];
  rootDocuments: WorkbenchDocumentTreeItem[];
  activeDocumentId?: string;
  onCommand(command: DocumentTreeCommand): void;
  onDocumentNavigate: DocumentNavigationHandler;
  onDocumentSelect?: (documentId: string) => void;
  expandedDirectoryIds: Set<string>;
  onToggleDirectory(id: string): void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `root:${group.key}`,
    data: { directoryId: null, groupKey: group.key },
    disabled: !group.canWrite,
  });
  return (
    <section ref={setNodeRef} className={isOver ? "mb-3 bg-[#ddf4ff]" : "mb-3"}>
      <div className="group flex h-8 items-center gap-1 px-3 text-xs font-semibold uppercase text-[#57606a]">
        <span className="min-w-0 flex-1 truncate">{groupIndex === 0 ? "空间文档" : group.label}</span>
        {group.canWrite ? (
          <>
            <HeaderButton label={`${group.label}新建文件夹`} onClick={() => onCommand({ type: "create-directory", groupKey: group.key, parentId: null })}><FolderPlus size={14} /></HeaderButton>
            <HeaderButton label={`${group.label}新建文档`} onClick={() => onCommand({ type: "create-document", groupKey: group.key, directoryId: null })}><FilePlus2 size={14} /></HeaderButton>
          </>
        ) : null}
      </div>
      {rootDirectories.map((directory, index) => (
        <DirectoryNode
          key={directory.id}
          directory={directory}
          group={group}
          directories={group.directories}
          documents={group.documents}
          {...(activeDocumentId ? { activeDocumentId } : {})}
          depth={0}
          siblingIndex={index}
          siblingCount={rootDirectories.length}
          onCommand={onCommand}
          onDocumentNavigate={onDocumentNavigate}
          {...(onDocumentSelect ? { onDocumentSelect } : {})}
          expandedDirectoryIds={expandedDirectoryIds}
          onToggleDirectory={onToggleDirectory}
        />
      ))}
      {rootDocuments.map((document, index) => (
        <DocumentNode
          key={document.id}
          document={document}
          group={group}
          active={document.id === activeDocumentId}
          depth={0}
          siblingIndex={index}
          siblingCount={rootDocuments.length}
          onCommand={onCommand}
        onDocumentNavigate={onDocumentNavigate}
        {...(onDocumentSelect ? { onDocumentSelect } : {})}
        />
      ))}
      {rootDirectories.length === 0 && rootDocuments.length === 0 ? <div className="px-4 py-2 text-xs text-[#8c959f]">暂无文档</div> : null}
    </section>
  );
}
