// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoopCreateButton } from "./loop-library";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("LoopCreateButton", () => {
  it("creates a valid no-human draft in the selected Space", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: { loopDefinitionId: "loop_new" },
    }), { status: 201, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LoopCreateButton
      spaces={[{ id: "space_1", label: "研发团队" }]}
      defaultSpaceId="space_1"
      onCreated={onCreated}
    />);

    await user.click(screen.getByRole("button", { name: "新建 Loop" }));
    await user.type(screen.getByRole("textbox", { name: "Loop 名称" }), "自动交付");
    await user.click(screen.getByRole("button", { name: "创建草稿" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      spaceId: string;
      scope: string;
      graph: { schemaVersion: number; routingMetadata: Record<string, unknown>; nodes: Array<{ type: string }> };
    };
    expect(body.spaceId).toBe("space_1");
    expect(body.scope).toBe("task");
    expect(body.graph.schemaVersion).toBe(2);
    expect(body.graph.routingMetadata).toEqual({});
    expect(body.graph.nodes.map((node) => node.type)).toEqual(["start", "end"]);
    expect(body.graph.nodes.some((node) => node.type === "human_gate")).toBe(false);
    expect(onCreated).toHaveBeenCalledWith("loop_new");
  });

  it("sends the selected Loop scope", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: { loopDefinitionId: "loop_project" },
    }), { status: 201, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LoopCreateButton spaces={[{ id: "space_1", label: "研发团队" }]} onCreated={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "新建 Loop" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Loop 级别" }), "project");
    await user.type(screen.getByRole("textbox", { name: "Loop 名称" }), "项目发布");
    await user.click(screen.getByRole("button", { name: "创建草稿" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ scope: "project" });
  });
});
