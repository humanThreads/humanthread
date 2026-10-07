import { describe, expect, it } from "vitest";
import { buildLoopGroupApplication, buildProjectLoopGroupConfig, loopGroupPresetSchema, projectLoopGroupConfigSchema, sanitizeProjectLoopNodeTaskLoopIds } from "./loop-group-presets";

describe("Loop 组预设应用", () => {
  it("合并多选预设、去重成员并使用默认预设的默认 Loop", () => {
    const result = buildLoopGroupApplication({
      presets: [
        {
          key: "研发交付",
          taskLoopIds: ["task_a", "task_shared"],
          defaultTaskLoopId: "project_a",
          projectLoopIds: ["project_a"],
          defaultProjectLoopId: "project_a",
        },
        {
          key: "测试回归",
          taskLoopIds: ["task_shared", "task_test"],
          defaultTaskLoopId: "project_test",
          projectLoopIds: ["project_test"],
          defaultProjectLoopId: "project_test",
        },
      ],
      selectedKeys: ["研发交付", "测试回归"],
      defaultPresetKey: "测试回归",
    });

    expect(result).toEqual({
      selectedPresetKeys: ["研发交付", "测试回归"],
      defaultPresetKey: "测试回归",
      taskLoopIds: ["task_a", "task_shared", "task_test"],
      defaultTaskLoopId: "project_test",
      projectLoopIds: ["project_a", "project_test"],
      defaultProjectLoopId: "project_test",
    });
  });

  it("拒绝空选择、重复选择和不存在的默认预设", () => {
    expect(() => buildLoopGroupApplication({
      presets: [{ key: "研发交付", taskLoopIds: ["task_a"], defaultTaskLoopId: "project_a", projectLoopIds: ["project_a"], defaultProjectLoopId: "project_a" }],
      selectedKeys: [],
    })).toThrow("至少选择一个 Loop 组预设");

    expect(() => buildLoopGroupApplication({
      presets: [{ key: "研发交付", taskLoopIds: ["task_a"], defaultTaskLoopId: "project_a", projectLoopIds: ["project_a"], defaultProjectLoopId: "project_a" }],
      selectedKeys: ["研发交付", "研发交付"],
    })).toThrow("Loop 组预设不能重复选择");

    expect(() => buildLoopGroupApplication({
      presets: [{ key: "研发交付", taskLoopIds: ["task_a"], defaultTaskLoopId: "project_a", projectLoopIds: ["project_a"], defaultProjectLoopId: "project_a" }],
      selectedKeys: ["研发交付"],
      defaultPresetKey: "不存在",
    })).toThrow("默认 Loop 组预设必须来自已选择的预设");
  });

  it("把模板预设固化为项目独立的 Loop 组配置", () => {
    const result = buildProjectLoopGroupConfig({
      presets: [
        {
          key: "研发交付",
          taskLoopIds: ["task_a", "task_b"],
          defaultTaskLoopId: "project_a",
          projectLoopIds: ["project_a"],
          defaultProjectLoopId: "project_a",
        },
        {
          key: "测试回归",
          taskLoopIds: ["task_test"],
          defaultTaskLoopId: "project_test",
          projectLoopIds: ["project_test"],
          defaultProjectLoopId: "project_test",
        },
      ],
      selection: { selectedPresetKeys: ["研发交付", "测试回归"], defaultPresetKey: "研发交付" },
    });

    expect(result).toEqual({
      taskLoopVersionIds: ["task_a", "task_b", "task_test"],
      defaultTaskLoopVersionId: "project_a",
      projectLoopVersionIds: ["project_a", "project_test"],
      defaultProjectLoopVersionId: "project_a",
      selectedPresetKeys: ["研发交付", "测试回归"],
      defaultPresetKey: "研发交付",
    });
    expect(projectLoopGroupConfigSchema.parse(result)).toEqual(result);
  });

  it("允许只使用项目级 Loop、不选择任务 Loop", () => {
    const preset = {
      key: "纯项目级流程",
      taskLoopIds: [],
      defaultTaskLoopId: "project_a",
      projectLoopIds: ["project_a"],
      defaultProjectLoopId: "project_a",
    };
    const config = {
      taskLoopVersionIds: [],
      defaultTaskLoopVersionId: "project_a",
      projectLoopVersionIds: ["project_a"],
      defaultProjectLoopVersionId: "project_a",
      selectedPresetKeys: ["纯项目级流程"],
      defaultPresetKey: "纯项目级流程",
    };

    expect(loopGroupPresetSchema.parse(preset)).toEqual(preset);
    expect(projectLoopGroupConfigSchema.parse(config)).toEqual(config);
    expect(buildProjectLoopGroupConfig({
      presets: [preset],
      selection: { selectedPresetKeys: ["纯项目级流程"], defaultPresetKey: "纯项目级流程" },
    })).toEqual(config);
  });

  it("要求默认任务 Loop 与默认里程碑 Loop 都来自项目 Loop 组", () => {
    expect(() => projectLoopGroupConfigSchema.parse({
      taskLoopVersionIds: ["task_a"], defaultTaskLoopVersionId: "task_a",
      projectLoopVersionIds: ["project_a"], defaultProjectLoopVersionId: "project_a",
      selectedPresetKeys: ["研发交付"], defaultPresetKey: "研发交付",
    })).toThrow();
  });

  it("保留项目 Loop 节点到任务 Loop 的映射，并清理无效引用", () => {
    expect(sanitizeProjectLoopNodeTaskLoopIds({
      project_delivery: { prepare: "task_a", verify: "task_missing" },
      removed_project: { prepare: "task_a" },
    }, { projectLoopIds: ["project_delivery"], taskLoopIds: ["task_a"] })).toEqual({
      project_delivery: { prepare: "task_a" },
    });
  });

  it("模板应用时复制节点映射", () => {
    const result = buildProjectLoopGroupConfig({
      presets: [{ key: "研发交付", taskLoopIds: ["task_a"], defaultTaskLoopId: "project_a", projectLoopIds: ["project_a"], defaultProjectLoopId: "project_a", projectLoopNodeTaskLoopIds: { project_a: { stage: "task_a" } } }],
      selection: { selectedPresetKeys: ["研发交付"], defaultPresetKey: "研发交付" },
    });
    expect(result.projectLoopNodeTaskLoopIds).toEqual({ project_a: { stage: "task_a" } });
  });
});
