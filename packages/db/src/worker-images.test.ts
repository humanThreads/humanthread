import { describe, expect, it } from "vitest";
import {
  createWorkerImageSource,
  createWorkerImageVersion,
  listAvailableWorkerImages,
  listWorkerImageCatalog,
  selectProjectWorkerImageVersion,
  setWorkerImageVersionStatus,
} from "./worker-images";

function fixture() {
  const sources: Array<Record<string, unknown>> = [];
  const versions: Array<Record<string, unknown>> = [];
  const projects: Array<Record<string, unknown>> = [
    { id: "project_1", ownerType: "personal", companyId: null, workerImageVersionId: null, version: 3 },
    { id: "project_company_1", ownerType: "company", companyId: "company_1", workerImageVersionId: null, version: 3 },
    { id: "project_company_2", ownerType: "company", companyId: "company_2", workerImageVersionId: null, version: 3 },
  ];
  const db = {
    $transaction: async <T>(callback: (tx: never) => Promise<T>) => callback(db as never),
    workerImageSource: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => sources.find((source) => matchesWhere(source, where)) ?? null,
      findMany: async ({ where }: { where?: Record<string, unknown> } = {}) => sources.filter((source) => !where || matchesWhere(source, where)),
      create: async ({ data }: { data: Record<string, unknown> }) => { sources.push(data); return data; },
    },
    workerImageVersion: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => versions.find((version) => matchesWhere(version, where)) ?? null,
      findMany: async ({ where }: { where?: Record<string, unknown> }) => versions.filter((version) => where?.status === undefined || version.status === where.status),
      create: async ({ data }: { data: Record<string, unknown> }) => { versions.push(data); return data; },
      updateMany: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const version = versions.find((candidate) => candidate.id === where.id);
        if (!version) return { count: 0 };
        Object.assign(version, data);
        return { count: 1 };
      },
    },
    project: {
      findUnique: async ({ where }: { where: { id: string } }) => projects.find((project) => project.id === where.id) ?? null,
      updateMany: async ({ where, data }: { where: { id: string; version: number }; data: Record<string, unknown> }) => {
        const project = projects.find((candidate) => candidate.id === where.id && candidate.version === where.version);
        if (!project) return { count: 0 };
        Object.assign(project, data, { version: Number(project.version) + 1 });
        return { count: 1 };
      },
    },
  };
  return { db, sources, versions, projects };
}

function matchesWhere(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR") return Array.isArray(value) && value.some((entry) => matchesWhere(row, entry as Record<string, unknown>));
    return row[key] === value;
  });
}

describe("Worker 镜像目录", () => {
  it("拒绝超过可唯一索引长度的镜像来源地址", async () => {
    const { db } = fixture();
    const repository = `registry.example.com/${"a".repeat(747)}`;

    await expect(createWorkerImageSource({
      actorUserId: "user_1",
      name: "超长来源",
      repository,
      now: new Date("2026-09-17T00:00:00Z"),
    }, { db: db as never })).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("仅列出来源和版本均为 active 的不可变镜像，并使用 MD5 标识", async () => {
    const { db } = fixture();
    const source = await createWorkerImageSource({ actorUserId: "user_1", name: "生产镜像", repository: "registry.example.com/humanthread-worker", now: new Date("2026-09-17T00:00:00Z") }, { db: db as never });
    await createWorkerImageVersion({ sourceId: source.id, tag: "20260917", digest: `sha256:${"a".repeat(64)}`, now: new Date("2026-09-17T00:00:00Z") }, { db: db as never });
    await createWorkerImageVersion({ sourceId: source.id, tag: "disabled", digest: `sha256:${"b".repeat(64)}`, status: "disabled", now: new Date("2026-09-17T00:00:00Z") }, { db: db as never });

    const available = await listAvailableWorkerImages({}, { db: db as never });
    expect(source.id).toMatch(/^[a-f0-9]{32}$/u);
    expect(available).toEqual([{ id: source.id, ownerType: "platform", companyId: null, name: "生产镜像", repository: "registry.example.com/humanthread-worker", versions: [expect.objectContaining({ tag: "20260917" })] }]);
  });

  it("为公司项目返回平台与本公司镜像，并拒绝选择其他公司的版本", async () => {
    const { db } = fixture();
    const platform = await createWorkerImageSource({
      actorUserId: "user_platform_admin",
      name: "平台镜像",
      repository: "registry.example.com/platform-worker",
      now: new Date("2026-09-17T00:00:00Z"),
    }, { db: db as never });
    const companyOne = await createWorkerImageSource({
      actorUserId: "user_company_admin",
      scope: { ownerType: "company", companyId: "company_1" },
      name: "公司一镜像",
      repository: "registry.example.com/company-one-worker",
      now: new Date("2026-09-17T00:00:00Z"),
    }, { db: db as never });
    const companyTwo = await createWorkerImageSource({
      actorUserId: "user_company_admin",
      scope: { ownerType: "company", companyId: "company_2" },
      name: "公司二镜像",
      repository: "registry.example.com/company-two-worker",
      now: new Date("2026-09-17T00:00:00Z"),
    }, { db: db as never });
    const platformVersion = await createWorkerImageVersion({ sourceId: platform.id, tag: "platform", digest: `sha256:${"a".repeat(64)}`, now: new Date("2026-09-17T00:00:00Z") }, { db: db as never });
    const companyOneVersion = await createWorkerImageVersion({ sourceId: companyOne.id, tag: "company-one", digest: `sha256:${"b".repeat(64)}`, now: new Date("2026-09-17T00:00:00Z") }, { db: db as never });
    const companyTwoVersion = await createWorkerImageVersion({ sourceId: companyTwo.id, tag: "company-two", digest: `sha256:${"c".repeat(64)}`, now: new Date("2026-09-17T00:00:00Z") }, { db: db as never });

    const companyOneAvailable = await listAvailableWorkerImages({ companyId: "company_1" }, { db: db as never });
    const personalAvailable = await listAvailableWorkerImages({ companyId: null }, { db: db as never });
    expect(companyOneAvailable.map((source) => source.id)).toEqual([platform.id, companyOne.id]);
    expect(personalAvailable.map((source) => source.id)).toEqual([platform.id]);

    await expect(selectProjectWorkerImageVersion({
      projectId: "project_company_1",
      expectedVersion: 3,
      workerImageVersionId: companyOneVersion.id,
    }, { db: db as never })).resolves.toMatchObject({ projectId: "project_company_1", workerImageVersionId: companyOneVersion.id });
    await expect(selectProjectWorkerImageVersion({
      projectId: "project_company_1",
      expectedVersion: 3,
      workerImageVersionId: companyTwoVersion.id,
    }, { db: db as never })).rejects.toMatchObject({ code: "validation_failed" });
    await expect(selectProjectWorkerImageVersion({
      projectId: "project_1",
      expectedVersion: 3,
      workerImageVersionId: platformVersion.id,
    }, { db: db as never })).resolves.toMatchObject({ projectId: "project_1", workerImageVersionId: platformVersion.id });
  });

  it("管理目录按平台或公司作用域隔离，不返回其他公司的来源", async () => {
    const { db } = fixture();
    await createWorkerImageSource({
      actorUserId: "user_platform_admin",
      name: "平台镜像",
      repository: "registry.example.com/platform-worker",
      now: new Date("2026-09-17T00:00:00Z"),
    }, { db: db as never });
    const companyOne = await createWorkerImageSource({
      actorUserId: "user_company_admin",
      scope: { ownerType: "company", companyId: "company_1" },
      name: "公司一镜像",
      repository: "registry.example.com/company-one-worker",
      now: new Date("2026-09-17T00:00:00Z"),
    }, { db: db as never });
    await createWorkerImageSource({
      actorUserId: "user_company_admin",
      scope: { ownerType: "company", companyId: "company_2" },
      name: "公司二镜像",
      repository: "registry.example.com/company-two-worker",
      now: new Date("2026-09-17T00:00:00Z"),
    }, { db: db as never });
    await createWorkerImageVersion({
      sourceId: companyOne.id,
      tag: "disabled",
      digest: `sha256:${"d".repeat(64)}`,
      status: "disabled",
      now: new Date("2026-09-17T00:00:00Z"),
    }, { db: db as never });

    const platformCatalog = await listWorkerImageCatalog({ scope: { ownerType: "platform", companyId: null } }, { db: db as never });
    const companyCatalog = await listWorkerImageCatalog({ scope: { ownerType: "company", companyId: "company_1" } }, { db: db as never });

    expect(platformCatalog.map((source) => source.name)).toEqual(["平台镜像"]);
    expect(companyCatalog).toEqual([
      expect.objectContaining({
        id: companyOne.id,
        ownerType: "company",
        companyId: "company_1",
        versions: [expect.objectContaining({ status: "disabled" })],
      }),
    ]);
  });

  it("允许平台和不同公司分别登记同一仓库，同时拒绝同一作用域内重复来源", async () => {
    const { db } = fixture();
    const repository = "ghcr.io/humanthreads/humanthread-linux-worker";
    const platform = await createWorkerImageSource({
      actorUserId: "user_platform_admin",
      name: "平台标准 Worker",
      repository,
      now: new Date("2026-09-25T00:00:00Z"),
    }, { db: db as never });
    const companyOne = await createWorkerImageSource({
      actorUserId: "user_company_one_admin",
      scope: { ownerType: "company", companyId: "company_1" },
      name: "公司一标准 Worker",
      repository,
      now: new Date("2026-09-25T00:00:00Z"),
    }, { db: db as never });
    const companyTwo = await createWorkerImageSource({
      actorUserId: "user_company_two_admin",
      scope: { ownerType: "company", companyId: "company_2" },
      name: "公司二标准 Worker",
      repository,
      now: new Date("2026-09-25T00:00:00Z"),
    }, { db: db as never });

    expect(new Set([platform.id, companyOne.id, companyTwo.id]).size).toBe(3);
    await expect(createWorkerImageSource({
      actorUserId: "user_company_one_admin",
      scope: { ownerType: "company", companyId: "company_1" },
      name: "重复来源",
      repository,
      now: new Date("2026-09-25T00:10:00Z"),
    }, { db: db as never })).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("并发创建同一作用域来源时返回可读的重复来源错误", async () => {
    const { db } = fixture();
    const source = db.workerImageSource as {
      findFirst: (args: { where: Record<string, unknown> }) => Promise<unknown>;
      create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
    };
    source.findFirst = async () => null;
    source.create = async () => {
      throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    };

    await expect(createWorkerImageSource({
      actorUserId: "user_1",
      name: "并发来源",
      repository: "registry.example.com/raced-worker",
      now: new Date("2026-09-25T00:20:00Z"),
    }, { db: db as never })).rejects.toMatchObject({
      code: "validation_failed",
      message: "Worker 镜像来源已存在",
    });
  });

  it("公司作用域不能向平台或其他公司的来源新增版本", async () => {
    const { db } = fixture();
    const platform = await createWorkerImageSource({
      actorUserId: "user_platform_admin",
      name: "平台镜像",
      repository: "registry.example.com/platform-worker",
      now: new Date("2026-09-17T00:00:00Z"),
    }, { db: db as never });
    const companyOne = await createWorkerImageSource({
      actorUserId: "user_company_admin",
      scope: { ownerType: "company", companyId: "company_1" },
      name: "公司一镜像",
      repository: "registry.example.com/company-one-worker",
      now: new Date("2026-09-17T00:00:00Z"),
    }, { db: db as never });

    await expect(createWorkerImageVersion({
      sourceId: platform.id,
      scope: { ownerType: "company", companyId: "company_1" },
      tag: "forbidden-platform",
      digest: `sha256:${"e".repeat(64)}`,
      now: new Date("2026-09-17T00:00:00Z"),
    }, { db: db as never })).rejects.toMatchObject({ code: "validation_failed" });
    await expect(createWorkerImageVersion({
      sourceId: companyOne.id,
      scope: { ownerType: "company", companyId: "company_2" },
      tag: "forbidden-company",
      digest: `sha256:${"f".repeat(64)}`,
      now: new Date("2026-09-17T00:00:00Z"),
    }, { db: db as never })).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("拒绝项目选择已停用版本，且不会修改项目引用", async () => {
    const { db, sources } = fixture();
    sources.push({ id: "a".repeat(32), name: "停用来源", repository: "registry.example.com/disabled", status: "active", createdByUserId: "user_1", createdAt: new Date(), updatedAt: new Date() });
    const versions = (db as unknown as { workerImageVersion: { create(args: { data: Record<string, unknown> }): Promise<unknown> } }).workerImageVersion;
    await versions.create({ data: { id: "b".repeat(32), sourceId: "a".repeat(32), tag: "disabled", digest: `sha256:${"b".repeat(64)}`, status: "disabled", createdAt: new Date(), updatedAt: new Date() } });

    await expect(selectProjectWorkerImageVersion({ projectId: "project_1", expectedVersion: 3, workerImageVersionId: "b".repeat(32) }, { db: db as never })).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("平台和公司管理员只能启用或禁用自己的镜像版本", async () => {
    const { db } = fixture();
    const platform = await createWorkerImageSource({
      actorUserId: "user_platform_admin",
      name: "平台镜像",
      repository: "registry.example.com/platform-worker",
      now: new Date("2026-09-17T00:00:00Z"),
    }, { db: db as never });
    const companyOne = await createWorkerImageSource({
      actorUserId: "user_company_admin",
      scope: { ownerType: "company", companyId: "company_1" },
      name: "公司一镜像",
      repository: "registry.example.com/company-one-worker",
      now: new Date("2026-09-17T00:00:00Z"),
    }, { db: db as never });
    const companyTwo = await createWorkerImageSource({
      actorUserId: "user_company_admin",
      scope: { ownerType: "company", companyId: "company_2" },
      name: "公司二镜像",
      repository: "registry.example.com/company-two-worker",
      now: new Date("2026-09-17T00:00:00Z"),
    }, { db: db as never });
    const platformVersion = await createWorkerImageVersion({ sourceId: platform.id, tag: "platform", digest: `sha256:${"1".repeat(64)}`, now: new Date("2026-09-17T00:00:00Z") }, { db: db as never });
    const companyOneVersion = await createWorkerImageVersion({ sourceId: companyOne.id, tag: "company-one", digest: `sha256:${"2".repeat(64)}`, now: new Date("2026-09-17T00:00:00Z") }, { db: db as never });
    const companyTwoVersion = await createWorkerImageVersion({ sourceId: companyTwo.id, tag: "company-two", digest: `sha256:${"3".repeat(64)}`, now: new Date("2026-09-17T00:00:00Z") }, { db: db as never });

    await expect(setWorkerImageVersionStatus({
      versionId: platformVersion.id,
      status: "disabled",
      scope: { ownerType: "platform", companyId: null },
      now: new Date("2026-09-17T00:10:00Z"),
    }, { db: db as never })).resolves.toMatchObject({ id: platformVersion.id, status: "disabled" });
    await expect(setWorkerImageVersionStatus({
      versionId: companyOneVersion.id,
      status: "disabled",
      scope: { ownerType: "company", companyId: "company_1" },
      now: new Date("2026-09-17T00:10:00Z"),
    }, { db: db as never })).resolves.toMatchObject({ id: companyOneVersion.id, status: "disabled" });
    await expect(setWorkerImageVersionStatus({
      versionId: companyTwoVersion.id,
      status: "disabled",
      scope: { ownerType: "company", companyId: "company_1" },
      now: new Date("2026-09-17T00:10:00Z"),
    }, { db: db as never })).rejects.toMatchObject({ code: "validation_failed" });
    await expect(setWorkerImageVersionStatus({
      versionId: platformVersion.id,
      status: "active",
      scope: { ownerType: "company", companyId: "company_1" },
      now: new Date("2026-09-17T00:10:00Z"),
    }, { db: db as never })).rejects.toMatchObject({ code: "validation_failed" });
  });
});
