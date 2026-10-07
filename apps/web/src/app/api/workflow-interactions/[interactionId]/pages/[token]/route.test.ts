import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  getInteraction: vi.fn(),
  canReadProject: vi.fn(),
}));

vi.mock("@/lib/workbench/workbench-api-session", () => ({
  resolveWorkbenchApiActor: mocks.actor,
}));

vi.mock("@humanthread/db", () => ({
  getWorkflowInteraction: mocks.getInteraction,
  assertCanReadProject: mocks.canReadProject,
}));

import { GET } from "./route";
import {
  bindTemporaryReviewPages,
  registerTemporaryReviewPage,
  resetTemporaryReviewPages,
} from "@/lib/workflow-interaction/temporary-review-page";

const interactionId = "workflow-interaction:abc";

function context(overrides: Partial<{ interactionId: string; token: string }> = {}) {
  return {
    params: Promise.resolve({ interactionId, token: "0".repeat(32), ...overrides }),
  };
}

describe("GET workflow interaction review page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetTemporaryReviewPages();
    mocks.actor.mockResolvedValue({ userId: "user_1" });
    mocks.getInteraction.mockResolvedValue({ id: interactionId, projectId: "project_1" });
    mocks.canReadProject.mockResolvedValue({ projectId: "project_1", role: "viewer" });
  });

  it("serves a bound page as locked-down HTML", async () => {
    const reference = registerTemporaryReviewPage({
      fileName: "TASK-1001-chapter-plan.html",
      html: "<!doctype html><title>plan</title>",
    });
    bindTemporaryReviewPages({ interactionId, tokens: [reference.token] });

    const response = await GET(
      new Request(`http://localhost/api/workflow-interactions/${interactionId}/pages/${reference.token}`),
      context({ token: reference.token }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("content-security-policy")).toContain("sandbox");
    expect(response.headers.get("cache-control")).toContain("no-store");
    // The body is the Agent's page verbatim; the token is the capability.
    await expect(response.text()).resolves.toBe("<!doctype html><title>plan</title>");
  });

  it("renders a readable placeholder instead of raw JSON once the page is gone", async () => {
    // The iframe must not show JSON to the human, so a missing page answers
    // with an HTML explanation and a 404.
    const response = await GET(
      new Request("http://localhost/api/workflow-interactions/x/pages/y"),
      context(),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("text/html");
    await expect(response.text()).resolves.toContain("该审阅页不可用");
  });

  it("refuses an unauthenticated reader before touching the interaction", async () => {
    mocks.actor.mockRejectedValue(new Error("Workbench API authentication required"));

    const response = await GET(
      new Request("http://localhost/api/workflow-interactions/x/pages/y"),
      context(),
    );

    expect(response.status).toBe(401);
    expect(mocks.getInteraction).not.toHaveBeenCalled();
  });

  it("refuses a reader who cannot read the owning project", async () => {
    const reference = registerTemporaryReviewPage({ fileName: "plan.html", html: "<p>plan</p>" });
    bindTemporaryReviewPages({ interactionId, tokens: [reference.token] });
    mocks.canReadProject.mockRejectedValue(Object.assign(new Error("access denied"), { code: "authorization_denied" }));

    const response = await GET(
      new Request(`http://localhost/api/workflow-interactions/${interactionId}/pages/${reference.token}`),
      context({ token: reference.token }),
    );

    expect(response.status).toBe(403);
  });
});
