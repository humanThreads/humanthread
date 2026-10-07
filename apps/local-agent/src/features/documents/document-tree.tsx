import type { DesktopDocumentTreeResponse } from "@humanthread/workbench-client";
import { ChevronRight, FileText, Folder } from "lucide-react";
import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { Link } from "react-router-dom";
import {
  handoffDocumentWorkspaceNavigation,
  readDocumentWorkspaceSnapshot,
  shouldRestoreCurrentDocumentWorkspace,
  writeDocumentWorkspaceSnapshot,
} from "./document-workspace-state";

type DocumentGroup = DesktopDocumentTreeResponse["data"]["groups"][number];
type DocumentNavigationHandler = (group: DocumentGroup, targetPathname: string) => void;

function isPrimaryDocumentNavigation(event: MouseEvent<HTMLAnchorElement>) {
  return !event.defaultPrevented
    && event.button === 0
    && !event.metaKey
    && !event.ctrlKey
    && !event.shiftKey
    && !event.altKey
    && (!event.currentTarget.target || event.currentTarget.target === "_self");
}

function DirectoryBranch(props: {
  directory: DocumentGroup["directories"][number];
  group: DocumentGroup;
  selectedDocumentId?: string;
  expandedDirectoryIds: Set<string>;
  onToggleDirectory(id: string): void;
  onDocumentNavigate: DocumentNavigationHandler;
}) {
  const expanded = props.expandedDirectoryIds.has(props.directory.id);
  const childDirectories = props.group.directories
    .filter((directory) => directory.parentId === props.directory.id)
    .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name));
  const documents = props.group.documents
    .filter((document) => document.directoryId === props.directory.id)
    .sort((left, right) => left.sortOrder - right.sortOrder || left.title.localeCompare(right.title));

  return (
    <li role="treeitem" aria-expanded={expanded}>
      <button className="document-tree-folder" onClick={() => props.onToggleDirectory(props.directory.id)} type="button">
        <ChevronRight aria-hidden="true" className={expanded ? "is-expanded" : ""} size={13} />
        <Folder aria-hidden="true" size={14} />
        <span>{props.directory.name}</span>
      </button>
      {expanded ? (
        <ul role="group">
          {childDirectories.map((directory) => (
            <DirectoryBranch
              directory={directory}
              group={props.group}
              key={directory.id}
              {...(props.selectedDocumentId ? { selectedDocumentId: props.selectedDocumentId } : {})}
              expandedDirectoryIds={props.expandedDirectoryIds}
              onToggleDirectory={props.onToggleDirectory}
              onDocumentNavigate={props.onDocumentNavigate}
            />
          ))}
          {documents.map((document) => (
            <li key={document.id}>
              <Link
                aria-current={document.id === props.selectedDocumentId ? "page" : undefined}
                className="document-tree-document"
                to={document.route}
                onClick={(event) => {
                  if (isPrimaryDocumentNavigation(event)) props.onDocumentNavigate(props.group, document.route);
                }}
              >
                <FileText aria-hidden="true" size={14} />
                <span>{document.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function DocumentTree(props: {
  groups: DesktopDocumentTreeResponse["data"]["groups"];
  selectedDocumentId?: string;
  workspaceScopeKey?: string;
}) {
  const scopeKey = props.workspaceScopeKey ?? "space";
  const shouldRestore = useMemo(
    () => shouldRestoreCurrentDocumentWorkspace(scopeKey),
    [scopeKey],
  );
  const visibleDirectoryIds = useMemo(
    () => new Set(props.groups.flatMap((group) => group.directories.map((directory) => directory.id))),
    [props.groups],
  );
  const [storedExpandedDirectoryIds, setStoredExpandedDirectoryIds] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    const snapshot = readDocumentWorkspaceSnapshot(scopeKey, window.sessionStorage, shouldRestore);
    return new Set(snapshot?.expandedDirectoryIds ?? []);
  });
  const expandedDirectoryIds = useMemo(
    () => new Set([...storedExpandedDirectoryIds].filter((id) => visibleDirectoryIds.has(id))),
    [storedExpandedDirectoryIds, visibleDirectoryIds],
  );
  useEffect(() => {
    if (shouldRestore && expandedDirectoryIds.size !== storedExpandedDirectoryIds.size) {
      writeDocumentWorkspaceSnapshot(scopeKey, { expandedDirectoryIds: [...expandedDirectoryIds] });
    }
  }, [expandedDirectoryIds, scopeKey, shouldRestore, storedExpandedDirectoryIds]);
  function toggleDirectory(id: string) {
    setStoredExpandedDirectoryIds((current) => {
      const next = new Set([...current].filter((currentId) => visibleDirectoryIds.has(currentId)));
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeDocumentWorkspaceSnapshot(scopeKey, { expandedDirectoryIds: [...next] });
      return next;
    });
  }

  function recordDocumentNavigation(group: DocumentGroup, targetPathname: string) {
    const targetScopeKey = group.projectId ?? "space";
    const isSpaceWorkspace = scopeKey === "space" || scopeKey.startsWith("space:");
    if (scopeKey !== targetScopeKey && !isSpaceWorkspace) return;
    handoffDocumentWorkspaceNavigation(scopeKey, targetScopeKey, targetPathname);
  }
  return (
    <nav aria-label="文档目录" className="document-tree" role="tree">
      {props.groups.map((group) => {
        const roots = group.directories.filter((directory) => directory.parentId === null);
        const rootDocuments = group.documents.filter((document) => document.directoryId === null);
        return (
          <section className="document-tree-group" key={group.key}>
            <header>
              <strong>{group.label}</strong>
              <span>{group.documents.length}</span>
            </header>
            {roots.length || rootDocuments.length ? (
              <ul role="group">
                {roots.map((directory) => (
                  <DirectoryBranch
                    directory={directory}
                    group={group}
                    key={directory.id}
                    {...(props.selectedDocumentId ? { selectedDocumentId: props.selectedDocumentId } : {})}
                    expandedDirectoryIds={expandedDirectoryIds}
                    onToggleDirectory={toggleDirectory}
                    onDocumentNavigate={recordDocumentNavigation}
                  />
                ))}
                {rootDocuments.map((document) => (
                  <li key={document.id}>
                    <Link
                      aria-current={document.id === props.selectedDocumentId ? "page" : undefined}
                      className="document-tree-document"
                      to={document.route}
                      onClick={(event) => {
                        if (isPrimaryDocumentNavigation(event)) recordDocumentNavigation(group, document.route);
                      }}
                    >
                      <FileText aria-hidden="true" size={14} />
                      <span>{document.title}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : <p>此容器还没有文档</p>}
          </section>
        );
      })}
    </nav>
  );
}
