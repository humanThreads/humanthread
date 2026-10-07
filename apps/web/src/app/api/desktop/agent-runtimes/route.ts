import {
  desktopAgentRuntimeCollectionResponseSchema,
  desktopAgentRuntimeMutationResponseSchema,
  deviceRuntimeProfileUpsertRequestSchema,
} from "@humanthread/workbench-client";

import {
  readDesktopAgentRuntimes,
  updateDesktopAgentRuntime,
} from "@/lib/desktop/desktop-execution-configuration";
import {
  createDesktopConfigurationErrorResponse,
  createDesktopCorsPreflightResponse,
  createDesktopJsonResponse,
} from "../../../../lib/desktop/desktop-cors";

const METHODS = ["GET", "PUT", "OPTIONS"] as const;

export function OPTIONS(request: Request) {
  return createDesktopCorsPreflightResponse(request, METHODS);
}

export async function GET(request: Request) {
  try {
    const runtimeProfiles = await readDesktopAgentRuntimes(request);
    const body = desktopAgentRuntimeCollectionResponseSchema.parse({
      ok: true,
      data: { runtimeProfiles },
    });
    return createDesktopJsonResponse(request, METHODS, body);
  } catch (error) {
    return createDesktopConfigurationErrorResponse(
      request,
      METHODS,
      error,
      "Desktop Agent runtime read failed",
    );
  }
}

export async function PUT(request: Request) {
  try {
    const input = deviceRuntimeProfileUpsertRequestSchema.parse(await request.json());
    const runtimeProfile = await updateDesktopAgentRuntime(request, input);
    const body = desktopAgentRuntimeMutationResponseSchema.parse({
      ok: true,
      data: { runtimeProfile },
    });
    return createDesktopJsonResponse(request, METHODS, body);
  } catch (error) {
    return createDesktopConfigurationErrorResponse(
      request,
      METHODS,
      error,
      "Desktop Agent runtime update failed",
    );
  }
}
