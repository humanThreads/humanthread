import {
  desktopWorkspaceConfigurationMutationResponseSchema,
  workspaceConfigurationRevokeRequestSchema,
  workspaceConfigurationUpsertRequestSchema,
} from "@humanthread/workbench-client";

import {
  revokeDesktopWorkspace,
  updateDesktopWorkspace,
} from "@/lib/desktop/desktop-execution-configuration";
import {
  createDesktopConfigurationErrorResponse,
  createDesktopCorsPreflightResponse,
  createDesktopJsonResponse,
} from "../../../../../../lib/desktop/desktop-cors";

const METHODS = ["PUT", "DELETE", "OPTIONS"] as const;

export function OPTIONS(request: Request) {
  return createDesktopCorsPreflightResponse(request, METHODS);
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    const input = workspaceConfigurationUpsertRequestSchema.parse(await request.json());
    const result = await updateDesktopWorkspace(request, projectId, input);
    const body = desktopWorkspaceConfigurationMutationResponseSchema.parse({
      ok: true,
      data: { workspace: toResponse(result) },
    });
    return createDesktopJsonResponse(request, METHODS, body);
  } catch (error) {
    return createDesktopConfigurationErrorResponse(
      request,
      METHODS,
      error,
      "Desktop Workspace update failed",
    );
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    const input = workspaceConfigurationRevokeRequestSchema.parse(await request.json());
    const result = await revokeDesktopWorkspace(request, projectId, input);
    const body = desktopWorkspaceConfigurationMutationResponseSchema.parse({
      ok: true,
      data: { workspace: toResponse(result) },
    });
    return createDesktopJsonResponse(request, METHODS, body);
  } catch (error) {
    return createDesktopConfigurationErrorResponse(
      request,
      METHODS,
      error,
      "Desktop Workspace revocation failed",
    );
  }
}

function toResponse(workspace: {
  id: string;
  status: string;
  pathFingerprint: string;
  configurationVersion: number;
  lastValidatedAt: string | null;
}) {
  return {
    bindingId: workspace.id,
    status: workspace.status,
    pathFingerprint: workspace.pathFingerprint,
    configurationVersion: workspace.configurationVersion,
    lastValidatedAt: workspace.lastValidatedAt,
  };
}
