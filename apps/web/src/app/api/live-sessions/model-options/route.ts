import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { getLiveSessionControl } from "@/lib/live-session/live-session-store";

export async function GET(request: Request): Promise<Response> {
  try {
    const actor = await resolveWorkbenchApiActor(request);
    const url = new URL(request.url);
    const kind = url.searchParams.get("kind")?.trim();
    const spaceId = url.searchParams.get("spaceId")?.trim() ?? "";
    const projectId = url.searchParams.get("projectId")?.trim() ?? "";
    const deviceId = url.searchParams.get("deviceId")?.trim() ?? "";
    if (!spaceId) return errorResponse(400, "model_options_space_required", "Space is required");

    const control = getLiveSessionControl();

    if (kind === "worker") {
      if (!projectId) return errorResponse(400, "model_options_project_required", "Worker model options require a project");
      await control.authorizeProject({ userId: actor.userId, projectId });
      const sites = await control.listModelSites({ userId: actor.userId, projectId });
      let resolved: { siteId: string; model: string; reasoningEffort: string } | null = null;
      let unavailableReason: string | null = null;
      try {
        const runtime = await control.resolveDirectWorkerRuntime({ projectId });
        // The runtime carries endpoint and apiKey; only the non-secret parts leave
        // this route. The site id is recovered by matching the resolved site.
        const matched = sites.find((site) => site.models.some((entry) => entry.name === runtime.model));
        resolved = {
          siteId: matched?.id ?? sites[0]?.id ?? "",
          model: runtime.model,
          reasoningEffort: runtime.reasoningEffort,
        };
      } catch (error) {
        unavailableReason = errorCode(error, "worker_direct_runtime_missing");
      }
      return Response.json({
        ok: true,
        result: {
          sites: sites.map((site) => ({ id: site.id, name: site.name, models: site.models })),
          default: unavailableReason ? null : resolved,
          defaultSource: unavailableReason ? null : "project-binding",
          unavailableReason,
        },
      });
    }

    if (kind === "agent") {
      if (!deviceId) return errorResponse(400, "model_options_device_required", "Agent model options require a device");
      const device = await control.loadAgentDevice({ userId: actor.userId, deviceId });
      if (!device || device.userId !== actor.userId || device.status !== "authorized") {
        return errorResponse(409, "agent_device_offline", "Agent device is unavailable");
      }
      const reported = device.modelSites ?? [];
      return Response.json({
        ok: true,
        result: {
          sites: reported.map((site) => ({ id: site.siteId, name: site.name, models: site.models })),
          default: null,
          // Desktop owns the account-default model, so the platform can name the
          // source but cannot resolve the concrete value.
          defaultSource: "desktop-account",
          unavailableReason: reported.length === 0 ? "agent_model_profile_unavailable" : null,
        },
      });
    }

    return errorResponse(400, "model_options_kind_invalid", "Session kind must be agent or worker");
  } catch (error) {
    return errorResponse(400, errorCode(error, "validation_failed"), error instanceof Error ? error.message : "Model options failed");
  }
}

function errorCode(error: unknown, fallback: string): string {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : fallback;
}

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json({ ok: false, code, error: message }, { status });
}
