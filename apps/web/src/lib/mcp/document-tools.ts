import {
  appendWorkbenchDocument,
  createWorkbenchDocument,
  createWorkbenchSpaceDocument,
  getWorkbenchDocument,
  listWorkbenchDocumentTargetTree,
  listProjectDocuments,
  listSpaceDocuments,
  searchWorkbenchDocuments,
  moveWorkbenchDocument,
  updateWorkbenchDocument,
} from "../workbench/workbench-documents";
import { saveWorkbenchDocumentAttachment } from "../workbench/workbench-document-attachments";
import { createDocumentAttachmentFile } from "./document-attachment-codec";

type ListProjectDocumentsResult = Awaited<ReturnType<typeof listProjectDocuments>>;

type DispatchMcpDocumentToolDependencies = {
  listProjectDocuments?: typeof listProjectDocuments;
  listSpaceDocuments?: typeof listSpaceDocuments;
  searchWorkbenchDocuments?: typeof searchWorkbenchDocuments;
  getWorkbenchDocument?: typeof getWorkbenchDocument;
  createWorkbenchDocument?: typeof createWorkbenchDocument;
  createWorkbenchSpaceDocument?: typeof createWorkbenchSpaceDocument;
  updateWorkbenchDocument?: typeof updateWorkbenchDocument;
  appendWorkbenchDocument?: typeof appendWorkbenchDocument;
  listWorkbenchDocumentTargetTree?: typeof listWorkbenchDocumentTargetTree;
  moveWorkbenchDocument?: typeof moveWorkbenchDocument;
  saveWorkbenchDocumentAttachment?: typeof saveWorkbenchDocumentAttachment;
};

export type McpDocumentToolRequest =
  | {
      tool: "list_documents";
      arguments: { spaceId: string; projectId?: string };
      actorUserId: string;
    }
  | {
      tool: "search_documents";
      arguments: { spaceId: string; projectId?: string; query: string };
      actorUserId: string;
    }
  | {
      tool: "list_document_tree";
      arguments: { spaceId: string; projectId?: string };
      actorUserId: string;
    }
  | {
      tool: "get_document";
      arguments: { documentId: string };
      actorUserId: string;
    }
  | {
      tool: "create_document";
      arguments: {
        spaceId: string;
        projectId?: string;
        title: string;
        path: string;
        contentMarkdown: string;
      };
      actorUserId: string;
    }
  | {
      tool: "update_document" | "append_document";
      arguments: {
        documentId: string;
        expectedVersion: number;
        title: string;
        contentMarkdown: string;
      };
      actorUserId: string;
    }
  | {
      tool: "move_document";
      arguments: { documentId: string; targetPath: string };
      actorUserId: string;
    }
  | {
      tool: "list_project_documents";
      arguments: {
        projectId: string;
      };
      actorUserId: string;
    }
  | {
      tool: "create_project_document";
      arguments: {
        projectId: string;
        title: string;
        path: string;
        contentMarkdown: string;
      };
      actorUserId: string;
    }
  | {
      tool: "update_project_document";
      arguments: {
        documentId: string;
        expectedVersion: number;
        title: string;
        contentMarkdown: string;
      };
      actorUserId: string;
    }
  | {
      tool: "upload_document_attachment";
      arguments: {
        documentId: string;
        fileName: string;
        mimeType: string;
        contentBase64: string;
      };
      actorUserId: string;
    };

export async function dispatchMcpDocumentTool(
  request: McpDocumentToolRequest,
  dependencies: DispatchMcpDocumentToolDependencies = {},
): Promise<Record<string, unknown>> {
  const listDocuments = dependencies.listProjectDocuments ?? listProjectDocuments;
  const listRootDocuments = dependencies.listSpaceDocuments ?? listSpaceDocuments;
  const searchDocuments =
    dependencies.searchWorkbenchDocuments ?? searchWorkbenchDocuments;
  const getDocument = dependencies.getWorkbenchDocument ?? getWorkbenchDocument;
  const createDocument =
    dependencies.createWorkbenchDocument ?? createWorkbenchDocument;
  const createRootDocument =
    dependencies.createWorkbenchSpaceDocument ?? createWorkbenchSpaceDocument;
  const updateDocument =
    dependencies.updateWorkbenchDocument ?? updateWorkbenchDocument;
  const appendDocument =
    dependencies.appendWorkbenchDocument ?? appendWorkbenchDocument;
  const listDocumentTree =
    dependencies.listWorkbenchDocumentTargetTree ?? listWorkbenchDocumentTargetTree;
  const moveDocument =
    dependencies.moveWorkbenchDocument ?? moveWorkbenchDocument;
  const saveDocumentAttachment =
    dependencies.saveWorkbenchDocumentAttachment ?? saveWorkbenchDocumentAttachment;

  switch (request.tool) {
    case "list_documents": {
      const documents = request.arguments.projectId
        ? await listDocuments({
            projectId: request.arguments.projectId,
            userId: request.actorUserId,
          })
        : await listRootDocuments({
            spaceId: request.arguments.spaceId,
            userId: request.actorUserId,
          });

      return { documents };
    }
    case "search_documents": {
      const documents = await searchDocuments({
        userId: request.actorUserId,
        spaceId: request.arguments.spaceId,
        ...(request.arguments.projectId
          ? { projectId: request.arguments.projectId }
          : {}),
        query: request.arguments.query,
      });

      return { documents };
    }
    case "list_document_tree": {
      const tree = await listDocumentTree({
        userId: request.actorUserId,
        spaceId: request.arguments.spaceId,
        ...(request.arguments.projectId
          ? { projectId: request.arguments.projectId }
          : {}),
      });

      return { tree };
    }
    case "get_document": {
      const document = await getDocument({
        documentId: request.arguments.documentId,
        userId: request.actorUserId,
      });

      return { document };
    }
    case "create_document": {
      const document = request.arguments.projectId
        ? await createDocument({
            spaceId: request.arguments.spaceId,
            projectId: request.arguments.projectId,
            userId: request.actorUserId,
            title: request.arguments.title,
            path: request.arguments.path,
            contentMarkdown: request.arguments.contentMarkdown,
            source: "mcp",
          })
        : await createRootDocument({
            spaceId: request.arguments.spaceId,
            userId: request.actorUserId,
            title: request.arguments.title,
            path: request.arguments.path,
            contentMarkdown: request.arguments.contentMarkdown,
            source: "mcp",
          });

      return { document };
    }
    case "move_document": {
      const document = await moveDocument({
        userId: request.actorUserId,
        documentId: request.arguments.documentId,
        targetPath: request.arguments.targetPath,
        sortOrder: 0,
      });

      return { document };
    }
    case "update_document":
    case "update_project_document": {
      const document = await updateDocument({
        documentId: request.arguments.documentId,
        userId: request.actorUserId,
        expectedVersion: request.arguments.expectedVersion,
        title: request.arguments.title,
        contentMarkdown: request.arguments.contentMarkdown,
        source: "mcp",
      });

      return { document };
    }
    case "append_document": {
      const document = await appendDocument({
        documentId: request.arguments.documentId,
        userId: request.actorUserId,
        expectedVersion: request.arguments.expectedVersion,
        title: request.arguments.title,
        contentMarkdown: request.arguments.contentMarkdown,
        source: "mcp",
      });

      return { document };
    }
    case "upload_document_attachment": {
      const file = createDocumentAttachmentFile({
        fileName: request.arguments.fileName,
        mimeType: request.arguments.mimeType,
        contentBase64: request.arguments.contentBase64,
      });
      const attachment = await saveDocumentAttachment({
        userId: request.actorUserId,
        documentId: request.arguments.documentId,
        file,
      });
      return { attachment };
    }
    case "list_project_documents": {
      const documents = (await listDocuments({
        projectId: request.arguments.projectId,
        userId: request.actorUserId,
      })) as ListProjectDocumentsResult;

      return {
        documents,
      };
    }
    case "create_project_document": {
      const document = await createDocument({
        projectId: request.arguments.projectId,
        userId: request.actorUserId,
        title: request.arguments.title,
        path: request.arguments.path,
        contentMarkdown: request.arguments.contentMarkdown,
        source: "mcp",
      });

      return {
        document,
      };
    }
  }
}
