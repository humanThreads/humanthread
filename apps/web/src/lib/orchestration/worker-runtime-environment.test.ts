import { describe, expect, it } from "vitest";
import { defaultWorkerRuntimeEnvironment, resolveWorkerRuntimeEnvironment, validateWorkerRuntimeVariables } from "./worker-runtime-environment";

describe("Worker 项目运行环境配置", () => {
  it("为常用 Node.js pnpm 环境快速填入 registry 和缓存变量", () => {
    const configuration = defaultWorkerRuntimeEnvironment("node-pnpm");
    expect(configuration.variables).toEqual(expect.arrayContaining([
      { name: "NPM_CONFIG_REGISTRY", value: "", pathValue: false },
      { name: "COREPACK_NPM_REGISTRY", value: "", pathValue: false },
      { name: "PNPM_HOME", value: "/pnpm", pathValue: true },
      { name: "npm_config_cache", value: "/npm", pathValue: true },
      { name: "XDG_CACHE_HOME", value: "/cache", pathValue: true },
    ]));
  });

  it("将相对子路径和 PVC 挂载根目录解析为容器绝对路径", () => {
    const configuration = defaultWorkerRuntimeEnvironment("node-pnpm");
    const resolved = resolveWorkerRuntimeEnvironment({ ...configuration, mountPath: "/workspace" });
    expect(resolved.mountPath).toBe("/workspace");
    expect(resolved.taskRoot).toBe("/workspace/tasks");
    expect(resolved.variables.PNPM_HOME).toBe("/workspace/pnpm");
    expect(resolved.variables.npm_config_cache).toBe("/workspace/npm");
  });

  it("拒绝敏感变量、路径穿越和任务目录冲突", () => {
    const configuration = defaultWorkerRuntimeEnvironment("node-pnpm");
    expect(() => validateWorkerRuntimeVariables({ ...configuration, variables: [{ name: "OPENAI_API_KEY", value: "secret", pathValue: false }] })).toThrow("敏感凭证");
    expect(() => validateWorkerRuntimeVariables({ ...configuration, variables: [{ name: "PNPM_HOME", value: "/../pnpm", pathValue: true }] })).toThrow();
    expect(() => validateWorkerRuntimeVariables({ ...configuration, taskSubpath: "/pnpm" })).toThrow("不能重复");
  });
});
