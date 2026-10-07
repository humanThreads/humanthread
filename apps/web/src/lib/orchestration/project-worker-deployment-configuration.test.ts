import { describe, expect, it } from "vitest";
import {
  defaultProjectWorkerDeploymentConfiguration,
  projectWorkerDeploymentConfigurationSchema,
  resolveProjectWorkerDeploymentConfiguration,
} from "./project-worker-deployment-configuration";

describe("项目 Worker 部署配置", () => {
  it("未保存配置时返回兼容默认值", () => {
    expect(resolveProjectWorkerDeploymentConfiguration(null)).toEqual(defaultProjectWorkerDeploymentConfiguration);
  });

  it("保存 PVC 容量和 HPA 副本范围", () => {
    expect(projectWorkerDeploymentConfigurationSchema.parse({
      schemaVersion: 1,
      kubernetes: {
        namespace: "etl",
        storageClass: "ceph-rwx",
        persistentStorage: "30Gi",
        minReplicas: 2,
        maxReplicas: 6,
      },
      concurrency: 3,
      sessionJournalRetentionDays: 45,
      healthPort: 18080,
      capabilities: { workspace: true, files: true, commands: true, gpu: false },
    })).toMatchObject({
      kubernetes: { persistentStorage: "30Gi", minReplicas: 2, maxReplicas: 6 },
      concurrency: 3,
      sessionJournalRetentionDays: 45,
      healthPort: 18080,
    });
  });

  it("拒绝最小副本大于最大副本", () => {
    expect(projectWorkerDeploymentConfigurationSchema.safeParse({
      ...defaultProjectWorkerDeploymentConfiguration,
      kubernetes: { ...defaultProjectWorkerDeploymentConfiguration.kubernetes, minReplicas: 4, maxReplicas: 3 },
    }).success).toBe(false);
  });
});
