import { describe, expect, it } from "vitest";
import {
  normalizeProjectEnvironmentConfiguration,
  projectEnvironmentConfigurationSchema,
  resolveProjectEnvironmentSources,
  sanitizeProjectEnvironmentConfiguration,
  validateNacosSourceScope,
  validateProjectRelativePath,
} from "./project-environment-configuration";

describe("项目环境配置契约", () => {
  it("只接受单一项目环境、执行端和凭证引用，不保存明文值", () => {
    const result = projectEnvironmentConfigurationSchema.parse({
      schemaVersion: 1,
      entries: [{
        id: "0123456789abcdef0123456789abcdef",
        name: "OPENAI_API_KEY",
        purpose: "模型调用",
        executionTargets: ["local_agent", "worker"],
        sourceType: "humanthread",
        reference: "OPENAI_API_KEY",
        status: "configured",
        revision: 1,
      }],
    });
    expect(result.entries[0]).not.toHaveProperty("value");
    expect(sanitizeProjectEnvironmentConfiguration(result)).toEqual(result);
  });

  it("保存非敏感 Worker 运行环境，但不把它当作凭证", () => {
    const result = normalizeProjectEnvironmentConfiguration({
      schemaVersion: 1,
      entries: [],
      workerRuntime: {
        profile: "node-pnpm",
        mountPath: "/var/lib/humanthread",
        taskSubpath: "/tasks",
        variables: [{ name: "PNPM_HOME", value: "/pnpm", pathValue: true }],
      },
    });
    expect(result.workerRuntime?.variables[0]?.name).toBe("PNPM_HOME");
    expect(() => normalizeProjectEnvironmentConfiguration({
      schemaVersion: 1,
      entries: [],
      workerRuntime: { profile: "custom", mountPath: "/var/lib/humanthread", taskSubpath: "/tasks", variables: [{ name: "API_TOKEN", value: "secret", pathValue: false }] },
    })).toThrow(/敏感凭证/u);
  });

  it("拒绝密码、Token 等明文凭证字段", () => {
    expect(() => sanitizeProjectEnvironmentConfiguration({
      schemaVersion: 1,
      entries: [{
        id: "0123456789abcdef0123456789abcdef",
        name: "TOKEN",
        purpose: "访问",
        executionTargets: ["worker"],
        sourceType: "humanthread",
        reference: "TOKEN",
        status: "configured",
        revision: 1,
        value: "secret",
      }],
    })).toThrow(/明文|凭证/u);
  });

  it("接受本地进程来源并按项目文件、HumanThread、Nacos、本地进程顺序解析", () => {
    const configuration = normalizeProjectEnvironmentConfiguration({
      schemaVersion: 1,
      entries: [{
        name: "API_URL",
        purpose: "服务地址",
        executionTargets: ["local_agent", "worker"],
        sourceType: "project_file",
        reference: ".env.production.local",
        status: "configured",
      }],
    });
    const result = resolveProjectEnvironmentSources({
      configuration,
      projectFile: { API_URL: "project" },
      humanthread: { API_URL: "project" },
      nacos: { API_URL: "project" },
      processEnv: { API_URL: "project" },
    });
    expect(result.values).toEqual({ API_URL: "project" });
    expect(result.resolved.API_URL!.sourceType).toBe("project_file");
  });

  it("同名来源值不一致时要求显式确认且诊断信息脱敏", () => {
    const configuration = normalizeProjectEnvironmentConfiguration({
      schemaVersion: 1,
      entries: [{
        name: "MODEL_TOKEN",
        purpose: "模型访问",
        executionTargets: ["worker"],
        sourceType: "humanthread",
        reference: "MODEL_TOKEN",
        status: "configured",
      }],
    });
    const result = resolveProjectEnvironmentSources({
      configuration,
      humanthread: { MODEL_TOKEN: "human-secret" },
      processEnv: { MODEL_TOKEN: "process-secret" },
    });
    expect(result.values).toEqual({});
    expect(result.conflicts).toEqual([expect.objectContaining({ name: "MODEL_TOKEN", requiresConfirmation: true })]);
    expect(JSON.stringify(result.diagnostics)).not.toContain("human-secret");
    expect(JSON.stringify(result.diagnostics)).not.toContain("process-secret");
  });

  it("确认冲突后只注入声明的变量并生成来源指纹", () => {
    const configuration = normalizeProjectEnvironmentConfiguration({
      schemaVersion: 1,
      entries: [{
        name: "MODEL_TOKEN",
        purpose: "模型访问",
        executionTargets: ["worker"],
        sourceType: "humanthread",
        reference: "MODEL_TOKEN",
        status: "configured",
      }],
    });
    const result = resolveProjectEnvironmentSources({
      configuration,
      humanthread: { MODEL_TOKEN: "human-secret", UNUSED: "not-injected" },
      processEnv: { MODEL_TOKEN: "process-secret" },
      confirmConflicts: ["MODEL_TOKEN"],
    });
    expect(result.values).toEqual({ MODEL_TOKEN: "human-secret" });
    expect(result.resolved.MODEL_TOKEN!.fingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.values).not.toHaveProperty("UNUSED");
  });

  it("拒绝绝对路径、路径穿越和越界的 Nacos 范围", () => {
    expect(() => validateProjectRelativePath("/tmp/.env")).toThrow(/相对路径/u);
    expect(() => validateProjectRelativePath("../secrets.env")).toThrow(/路径/u);
    expect(() => validateNacosSourceScope({ namespace: "public/ns", group: "DEFAULT_GROUP", dataId: "app.yaml" })).toThrow(/namespace|范围/u);
    expect(() => validateNacosSourceScope({ namespace: "prod", group: "DEFAULT_GROUP", dataId: "../app.yaml" })).toThrow(/dataId|范围/u);
    expect(() => normalizeProjectEnvironmentConfiguration({
      schemaVersion: 1,
      entries: [{ name: "API_URL", purpose: "服务地址", executionTargets: ["worker"], sourceType: "project_file", reference: ".env", sourceConfig: { projectPath: "/etc/secrets" }, status: "missing" }],
    })).toThrow(/相对路径/u);
  });
});
