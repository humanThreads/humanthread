import { describe, expect, it, vi } from "vitest";
import { readLoopRunProjection } from "@/lib/orchestration/loop-read-model";
import { requireWorkbenchSession } from "@/lib/workbench/workbench-route-auth";
import LoopRunPage, { LOOP_RUN_CONTENT_MODE } from "./page";

vi.mock("@/lib/orchestration/loop-read-model", () => ({ readLoopRunProjection: vi.fn() }));
vi.mock("@/lib/workbench/workbench-route-auth", () => ({ requireWorkbenchSession: vi.fn() }));
vi.mock("@/lib/workbench/workbench-companies", () => ({ getWorkbenchCompanyFilters: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/workbench/workbench-avatar", () => ({ getWorkbenchShellLoginProps: vi.fn().mockReturnValue({}) }));

describe("Loop run page", () => {
  it("authenticates the requested run route and renders the snapshot viewer in workspace mode", async () => {
    vi.mocked(requireWorkbenchSession).mockResolvedValue({ session: { loginEmail: "owner@example.com", context: { userId: "user_1" } } } as never);
    const projection = {
      run: { id: "run_1", status: "running" },
      parentRun: { id: "parent_run_1", status: "waiting" },
      childRuns: [],
    } as never;
    vi.mocked(readLoopRunProjection).mockResolvedValue(projection);

    const element = await LoopRunPage({ params: Promise.resolve({ loopRunId: "run_1" }) });

    expect(LOOP_RUN_CONTENT_MODE).toBe("workspace");
    expect(requireWorkbenchSession).toHaveBeenCalledWith("/loop-runs/run_1");
    expect(readLoopRunProjection).toHaveBeenCalledWith({ userId: "user_1", loopRunId: "run_1" });
    expect(element).toBeTruthy();
    expect(element.props.children.props.initialProjection).toBe(projection);
  });
});
