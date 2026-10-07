import { describe, expect, it } from "vitest";

import {
  validateCodexArgs,
  validateCodexRuntimeBinding,
  validateEnvironmentOverrides,
} from "./agent-runtime";

function providerArgs(): string[] {
  return [
    "--config",
    'model_provider="humanthread_local"',
    "--config",
    'model_providers.humanthread_local.name="HumanThread Desktop"',
    "--config",
    'model_providers.humanthread_local.base_url="https://models.example.com/v1"',
    "--config",
    'model_providers.humanthread_local.env_key="OPENAI_API_KEY"',
    "--config",
    'model_providers.humanthread_local.wire_api="responses"',
    "--config",
    "model_providers.humanthread_local.requires_openai_auth=false",
  ];
}

function reasoningArgs(): string[] {
  return ["--config", 'model_reasoning_effort="high"'];
}

describe("codex argument validation", () => {
  it("accepts the read-only structured exec shape and returns the schema path", () => {
    const schema = validateCodexArgs([
      "exec",
      "--json",
      "--sandbox",
      "read-only",
      "--output-schema",
      "/workspace/.humanthread/schema.json",
      "implement the task",
      ...reasoningArgs(),
    ]);
    expect(schema).toBe("/workspace/.humanthread/schema.json");
  });

  it("requires exactly one reasoning effort configuration", () => {
    expect(() =>
      validateCodexArgs(["exec", "--json", "--sandbox", "read-only", "--output-schema", "s.json", "go"]),
    ).toThrow("Codex reasoning effort arguments are invalid");
    expect(() =>
      validateCodexArgs([
        "exec", "--json", "--sandbox", "read-only", "--output-schema", "s.json", "go",
        ...reasoningArgs(), ...reasoningArgs(),
      ]),
    ).toThrow("Codex reasoning effort arguments are invalid");
  });

  it("rejects unknown flags and empty prompts", () => {
    expect(() =>
      validateCodexArgs([
        "exec", "--json", "--sandbox", "read-only", "--output-schema", "s.json", "",
        ...reasoningArgs(),
      ]),
    ).toThrow("Codex arguments are invalid");
    expect(() =>
      validateCodexArgs([
        "exec", "--json", "--sandbox", "workspace-write", "--output-schema", "s.json", "go",
        ...reasoningArgs(),
      ]),
    ).toThrow("Codex arguments are invalid");
  });

  it("requires a model and a matching base URL for local model providers", () => {
    const commandArgs = [
      "exec",
      ...providerArgs(),
      "--json",
      "--sandbox",
      "read-only",
      "--model",
      "gpt-5.6-terra",
      "--output-schema",
      "/workspace/schema.json",
      "go",
      ...reasoningArgs(),
    ];
    expect(validateCodexArgs(commandArgs)).toBe("/workspace/schema.json");

    const withoutModel = commandArgs.filter((value, index) => {
      if (value === "--model") return false;
      if (index > 0 && commandArgs[index - 1] === "--model") return false;
      return true;
    });
    expect(() => validateCodexArgs(withoutModel)).toThrow(
      "Codex local model provider requires an explicit model",
    );
  });

  it("binds independent credentials to the selected model site", () => {
    expect(() =>
      validateCodexRuntimeBinding(
        ["exec", "--json", "--sandbox", "read-only", "--output-schema", "s.json", "go"],
        { OPENAI_BASE_URL: "https://models.example.com/v1" },
        true,
      ),
    ).toThrow("Independent Codex credentials require the selected local model provider");

    const commandArgs = [
      "exec",
      ...providerArgs(),
      "--json",
      "--sandbox",
      "read-only",
      "--model",
      "gpt-5.6-terra",
      "--output-schema",
      "s.json",
      "go",
      ...reasoningArgs(),
    ];
    expect(() =>
      validateCodexRuntimeBinding(commandArgs, { OPENAI_BASE_URL: "https://other.example.com" }, false),
    ).toThrow("Codex local model provider does not match the selected model site");
    expect(() =>
      validateCodexRuntimeBinding(
        commandArgs,
        { OPENAI_BASE_URL: "https://models.example.com/v1" },
        true,
      ),
    ).not.toThrow();
  });

  it("only accepts OPENAI_BASE_URL environment overrides", () => {
    expect(() => validateEnvironmentOverrides({ OPENAI_BASE_URL: "https://models.example.com" })).not.toThrow();
    expect(() => validateEnvironmentOverrides({ OPENAI_API_KEY: "secret" })).toThrow(
      "Codex environment overrides are invalid",
    );
  });
});
