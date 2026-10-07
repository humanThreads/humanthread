// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkerPoolSettings } from "./worker-pool-settings";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("WorkerPoolSettings", () => {
  it("creates a user-owned pool and reveals its token only after password confirmation", async () => {
    const user = userEvent.setup();
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ pools: [{ id: "a".repeat(32), displayName: "disaster-gpu", status: "active", maxConcurrentRuns: 2, configuration: {}, lastSeenAt: null }] }))
      .mockResolvedValueOnce(Response.json({ ok: true, result: [] }))
      .mockResolvedValueOnce(Response.json({ pool: { id: "b".repeat(32), displayName: "standard", status: "active", maxConcurrentRuns: 1, configuration: {} }, bootstrapToken: "htwp_created" }, { status: 201 }))
      .mockResolvedValueOnce(Response.json({ bootstrapToken: "htwp_revealed" }));
    vi.stubGlobal("fetch", fetch);
    render(<WorkerPoolSettings projectId="project_1" />);

    expect(await screen.findByText("disaster-gpu")).toBeTruthy();
    await user.type(screen.getByLabelText("Worker Pool 名称"), "standard");
    await user.click(screen.getByRole("button", { name: "创建 Worker Pool" }));
    expect(await screen.findByText("htwp_created")).toBeTruthy();
    expect(screen.queryByText("htwp_revealed")).toBeNull();

    await user.click(screen.getAllByRole("button", { name: "显示 Token" })[0]!);
    await user.type(screen.getByLabelText("当前密码"), "password");
    await user.click(screen.getByRole("button", { name: "确认显示" }));
    await waitFor(() => expect(screen.getByText("htwp_revealed")).toBeTruthy());
    expect(fetch).toHaveBeenLastCalledWith(`/api/worker-pools/${"a".repeat(32)}/token`, expect.objectContaining({ method: "POST" }));
  });

  it("stores a Worker model site key without rendering it after save", async () => {
    const user = userEvent.setup();
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ pools: [] }))
      .mockResolvedValueOnce(Response.json({ ok: true, result: [] }))
      .mockResolvedValueOnce(Response.json({
        ok: true,
        result: {
          id: "b".repeat(32),
          name: "Delivery Codex",
          endpoint: "https://codex.example.com/v1",
          status: "active",
        },
      }, { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    render(<WorkerPoolSettings projectId="project_1" />);

    await user.type(screen.getByLabelText("模型站点名称"), "Delivery Codex");
    await user.type(screen.getByLabelText("模型站点 URL"), "https://codex.example.com/v1");
    await user.type(screen.getByLabelText("模型站点 Key"), "sk-configured-key");
    await user.type(screen.getByLabelText("模型站点模型清单"), "gpt-5.6-terra=GPT-5.6 Terra");
    await user.click(screen.getByRole("button", { name: "保存模型站点" }));

    await waitFor(() => expect(fetch).toHaveBeenLastCalledWith("/api/worker-model-sites", expect.objectContaining({ method: "POST" })));
    expect(fetch.mock.calls.at(-1)?.[1]?.body).toContain("sk-configured-key");
    expect(JSON.parse(String(fetch.mock.calls.at(-1)?.[1]?.body))).toMatchObject({
      models: [{ name: "gpt-5.6-terra", label: "GPT-5.6 Terra" }],
    });
    expect(screen.queryByText("sk-configured-key")).toBeNull();
    expect(screen.getByText("Delivery Codex")).toBeTruthy();
    expect(screen.getByText("https://codex.example.com/v1")).toBeTruthy();
  });

  it("updates the model catalogue of an existing Worker model site", async () => {
    const user = userEvent.setup();
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ pools: [] }))
      .mockResolvedValueOnce(Response.json({ ok: true, result: [{
        id: "b".repeat(32), name: "Delivery Codex", endpoint: "https://codex.example.com/v1",
        status: "active", models: [],
      }] }))
      .mockResolvedValueOnce(Response.json({ ok: true, result: {
        id: "b".repeat(32), name: "Delivery Codex", endpoint: "https://codex.example.com/v1",
        status: "active", models: [{ name: "gpt-5.6-terra", label: "GPT-5.6 Terra" }],
      } }));
    vi.stubGlobal("fetch", fetch);
    render(<WorkerPoolSettings projectId="project_1" />);

    expect(await screen.findByText("Delivery Codex")).toBeTruthy();
    expect(screen.getByText("未配置模型")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "配置站点模型 Delivery Codex" }));
    await user.type(screen.getByLabelText("站点模型清单 Delivery Codex"), "gpt-5.6-terra=GPT-5.6 Terra");
    await user.click(screen.getByRole("button", { name: "保存站点模型 Delivery Codex" }));

    await waitFor(() => expect(fetch).toHaveBeenLastCalledWith(
      `/api/worker-model-sites/${"b".repeat(32)}`,
      expect.objectContaining({ method: "PATCH" }),
    ));
    const patchBody = JSON.parse(String(fetch.mock.calls.at(-1)?.[1]?.body));
    expect(patchBody).toEqual({ models: [{ name: "gpt-5.6-terra", label: "GPT-5.6 Terra" }] });
    expect(patchBody).not.toHaveProperty("apiKey");
    expect(await screen.findByText("GPT-5.6 Terra")).toBeTruthy();
  });

  it("rejects a malformed model catalogue before calling the API", async () => {
    const user = userEvent.setup();
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ pools: [] }))
      .mockResolvedValueOnce(Response.json({ ok: true, result: [{
        id: "b".repeat(32), name: "Delivery Codex", endpoint: "https://codex.example.com/v1",
        status: "active", models: [],
      }] }));
    vi.stubGlobal("fetch", fetch);
    render(<WorkerPoolSettings projectId="project_1" />);

    await screen.findByText("Delivery Codex");
    await user.click(screen.getByRole("button", { name: "配置站点模型 Delivery Codex" }));
    await user.type(screen.getByLabelText("站点模型清单 Delivery Codex"), "missing-label-only");
    await user.click(screen.getByRole("button", { name: "保存站点模型 Delivery Codex" }));

    expect(screen.getByRole("alert").textContent).toContain("格式");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("shows the non-secret live capacity, execution count, health, and last-seen time", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ pools: [{
        id: "a".repeat(32), displayName: "disaster-gpu", status: "active", maxConcurrentRuns: 2,
        configuration: {}, health: "running", capacity: 2, currentRuns: 1,
        lastSeenAt: "2026-08-24T10:00:00.000Z",
        instances: [
          { instanceId: "human-agent-01", health: "running", requestedConcurrency: 1, currentRuns: 1, lastSeenAt: "2026-08-24T10:00:00.000Z" },
          { instanceId: "human-agent-02", health: "idle", requestedConcurrency: 1, currentRuns: 0, lastSeenAt: "2026-08-24T09:59:59.000Z" },
        ],
      }] }))
      .mockResolvedValueOnce(Response.json({ ok: true, result: [] }));
    vi.stubGlobal("fetch", fetch);
    render(<WorkerPoolSettings projectId="project_1" />);

    expect((await screen.findAllByText("运行中")).length).toBe(2);
    expect(screen.getByText("运行/容量 1/2")).toBeTruthy();
    expect(screen.getByText("运行 1")).toBeTruthy();
    expect(screen.getAllByText("最近在线 2026-08-24 10:00:00")).toHaveLength(2);
    expect(screen.getByText("human-agent-01")).toBeTruthy();
    expect(screen.getByText("human-agent-02")).toBeTruthy();
    expect(screen.getByText("实例 2")).toBeTruthy();
  });

  it("shows a Kubernetes task group and live replica count instead of historical pod names", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ pools: [{
        id: "a".repeat(32),
        displayName: "ht-agnet",
        status: "active",
        maxConcurrentRuns: 3,
        configuration: {},
        health: "idle",
        capacity: 3,
        currentRuns: 0,
        lastSeenAt: "2026-09-17T10:00:00.000Z",
        runtime: "kubernetes",
        taskGroupName: "ht-agnet",
        aliveInstanceCount: 3,
        instances: [],
      }] }))
      .mockResolvedValueOnce(Response.json({ ok: true, result: [] }));
    vi.stubGlobal("fetch", fetch);
    render(<WorkerPoolSettings projectId="project_1" />);

    expect(await screen.findByText("Kubernetes 任务组 ht-agnet")).toBeTruthy();
    expect(screen.getByText("存活实例 3")).toBeTruthy();
    expect(screen.queryByText("实例 0")).toBeNull();
  });

  it("requires confirmation before deleting a Worker Pool or model site", async () => {
    const user = userEvent.setup();
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ pools: [{ id: "a".repeat(32), displayName: "standard", status: "active", maxConcurrentRuns: 1, configuration: {} }] }))
      .mockResolvedValueOnce(Response.json({ ok: true, result: [{ id: "b".repeat(32), name: "proxy", endpoint: "https://codex.example.com/v1", status: "active" }] }))
      .mockResolvedValueOnce(Response.json({ ok: true }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetch);
    render(<WorkerPoolSettings />);

    expect(await screen.findByText("standard")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "删除 Worker Pool standard" }));
    expect(screen.getByRole("dialog").textContent).toContain("standard");
    expect(fetch).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole("button", { name: "确认删除 Worker Pool" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(screen.queryByText("standard")).toBeNull();

    await user.click(screen.getByRole("button", { name: "删除模型站点 proxy" }));
    await user.click(screen.getByRole("button", { name: "确认删除模型站点" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
    expect(screen.queryByText("proxy")).toBeNull();
  });
});
