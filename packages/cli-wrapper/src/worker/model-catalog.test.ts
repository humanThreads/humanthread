import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import {
  createRelayModelCatalog,
  createBundledModelCatalogReader,
  patchModelCatalogForDirectTools,
} from "./model-catalog";

function catalog(models: unknown[]): string {
  return JSON.stringify({ models });
}

describe("patchModelCatalogForDirectTools", () => {
  it("forces direct tools and standard Responses payloads for code-mode-only models", () => {
    const raw = catalog([
      { slug: "gpt-5.6-sol", tool_mode: "code_mode_only", use_responses_lite: true },
      { slug: "gpt-5.6-terra", tool_mode: "code_mode_only", use_responses_lite: true, context_window: 272_000 },
      { slug: "gpt-5.5", tool_mode: null, use_responses_lite: false },
    ]);

    const patched = patchModelCatalogForDirectTools(raw, "gpt-5.6-terra");

    expect(patched).toBeTypeOf("string");
    const parsed = JSON.parse(patched ?? "") as { models: Array<Record<string, unknown>> };
    expect(parsed.models[1]).toMatchObject({
      slug: "gpt-5.6-terra",
      tool_mode: "direct",
      use_responses_lite: false,
      context_window: 272_000,
    });
    expect(parsed.models[0]).toMatchObject({ slug: "gpt-5.6-sol", tool_mode: "code_mode_only" });
    expect(parsed.models[2]).toMatchObject({ slug: "gpt-5.5" });
  });

  it("upgrades entries that only need the standard Responses payload", () => {
    const raw = catalog([
      { slug: "relay-model", tool_mode: null, use_responses_lite: true },
    ]);

    const patched = patchModelCatalogForDirectTools(raw, "relay-model");

    expect(patched).not.toBeNull();
    expect((JSON.parse(patched ?? "") as { models: Array<Record<string, unknown>> }).models[0]).toMatchObject({
      slug: "relay-model",
      tool_mode: "direct",
      use_responses_lite: false,
      supports_reasoning_summary_parameter: false,
      default_reasoning_summary: "none",
    });
  });

  it("normalizes an existing direct model for relayed Responses", () => {
    const raw = catalog([
      { slug: "relay-model", tool_mode: "direct", use_responses_lite: false },
    ]);

    const patched = patchModelCatalogForDirectTools(raw, "relay-model", "max");

    expect(patched).not.toBeNull();
    expect((JSON.parse(patched ?? "") as { models: Array<Record<string, unknown>> }).models[0]).toMatchObject({
      slug: "relay-model",
      tool_mode: "direct",
      use_responses_lite: false,
      supports_reasoning_summary_parameter: false,
      default_reasoning_summary: "none",
    });
  });

  it("synthesizes a complete catalog entry when the selected relayed model is missing", () => {
    const raw = catalog([
      {
        slug: "gpt-5.5",
        display_name: "GPT-5.5",
        description: "Legacy coding model.",
        default_reasoning_level: "medium",
        supported_reasoning_levels: [{ effort: "medium", description: "Balanced" }],
        shell_type: "unified_exec",
        visibility: "list",
        supported_in_api: true,
        priority: 12,
        model_messages: { instructions_template: "You are Codex." },
        supports_reasoning_summary_parameter: true,
        default_reasoning_summary: "auto",
        use_responses_lite: false,
        tool_mode: null,
      },
    ]);

    const patched = patchModelCatalogForDirectTools(raw, "deepseek-v4.1-flash", "max");

    expect(patched).not.toBeNull();
    const parsed = JSON.parse(patched ?? "") as { models: Array<Record<string, unknown>> };
    expect(parsed.models).toHaveLength(2);
    expect(parsed.models[0]).toMatchObject({ slug: "gpt-5.5", use_responses_lite: false });
    expect(parsed.models[1]).toMatchObject({
      slug: "deepseek-v4.1-flash",
      display_name: "deepseek-v4.1-flash",
      default_reasoning_level: "max",
      tool_mode: "direct",
      use_responses_lite: false,
      supports_reasoning_summary_parameter: false,
      default_reasoning_summary: "none",
      shell_type: "unified_exec",
      visibility: "list",
      supported_in_api: true,
    });
    expect(parsed.models[1]?.supported_reasoning_levels).toEqual(expect.arrayContaining([
      expect.objectContaining({ effort: "max" }),
    ]));
  });

  it("rejects catalogs that cannot be trusted", () => {
    expect(patchModelCatalogForDirectTools("not-json", "model")).toBeNull();
    expect(patchModelCatalogForDirectTools(JSON.stringify({ models: "invalid" }), "model")).toBeNull();
  });
});

describe("createRelayModelCatalog", () => {
  it("creates a complete fallback catalog without a bundled Codex catalog", () => {
    const raw = createRelayModelCatalog("deepseek-v4.1-flash", "max");
    const parsed = JSON.parse(raw) as { models: Array<Record<string, unknown>> };

    expect(parsed.models).toHaveLength(1);
    expect(parsed.models[0]).toMatchObject({
      slug: "deepseek-v4.1-flash",
      display_name: "deepseek-v4.1-flash",
      default_reasoning_level: "max",
      tool_mode: "direct",
      use_responses_lite: false,
      supports_reasoning_summary_parameter: false,
      default_reasoning_summary: "none",
    });
    expect(Reflect.get(Reflect.get(parsed.models[0] ?? {}, "model_messages") ?? {}, "instructions_template")).toEqual(expect.any(String));
  });
});

function fakeReaderChild(stdout: string, exitCode = 0) {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  });
  queueMicrotask(() => {
    child.stdout.write(stdout);
    child.emit("exit", exitCode);
  });
  return child;
}

describe("createBundledModelCatalogReader", () => {
  it("reads the bundled catalog from a clean Codex home", async () => {
    const spawn = vi.fn().mockReturnValue(fakeReaderChild(catalog([{ slug: "gpt-5.6-terra" }])));
    const read = createBundledModelCatalogReader({ spawn: spawn as never, pathEnvironment: "/usr/bin" });

    await expect(read("codex", "/workspace/codex-home")).resolves.toBe(catalog([{ slug: "gpt-5.6-terra" }]));
    expect(spawn).toHaveBeenCalledWith("codex", ["debug", "models"], expect.objectContaining({
      env: { HOME: "/workspace/codex-home", CODEX_HOME: "/workspace/codex-home", PATH: "/usr/bin" },
    }));
  });

  it("returns null for a failed catalog read", async () => {
    const spawn = vi.fn().mockReturnValue(fakeReaderChild("", 1));
    const read = createBundledModelCatalogReader({ spawn: spawn as never });

    await expect(read("codex", "/workspace/codex-home")).resolves.toBeNull();
  });

  it("returns null when the catalog process cannot start", async () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    });
    const spawn = vi.fn().mockReturnValue(child);
    const read = createBundledModelCatalogReader({ spawn: spawn as never });
    const result = read("codex", "/workspace/codex-home");
    child.emit("error", new Error("spawn failed"));

    await expect(result).resolves.toBeNull();
  });
});
