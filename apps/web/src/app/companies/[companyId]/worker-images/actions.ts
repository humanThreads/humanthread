"use server";

import { revalidatePath } from "next/cache";
import { createWorkerImageSource, createWorkerImageVersion, setWorkerImageVersionStatus } from "@humanthread/db";
import { resolveWorkerManagementScope } from "../../../../lib/orchestration/worker-resource-scope";
import { requireWorkbenchSession } from "../../../../lib/workbench/workbench-route-auth";

export type CompanyWorkerImageCatalogInput =
  | { kind: "source"; name: string; repository: string }
  | { kind: "version"; sourceId: string; tag: string; digest: string }
  | { kind: "version-status"; versionId: string; status: "active" | "disabled" };

export async function updateCompanyWorkerImageCatalogAction(
  companyId: string,
  input: CompanyWorkerImageCatalogInput,
): Promise<{ ok: boolean; formError?: string }> {
  try {
    const { session } = await requireWorkbenchSession(`/companies/${companyId}/worker-images`);
    const { scope } = await resolveWorkerManagementScope({ userId: session.context.userId, companyId });
    if (scope.ownerType !== "company" || !scope.companyId) throw new Error("公司 Worker 镜像作用域无效");
    const companyScope = { ownerType: "company" as const, companyId: scope.companyId };
    if (input.kind === "source") {
      await createWorkerImageSource({
        actorUserId: session.context.userId,
        scope: companyScope,
        name: input.name,
        repository: input.repository,
        now: new Date(),
      });
    } else if (input.kind === "version") {
      await createWorkerImageVersion({
        sourceId: input.sourceId,
        scope: companyScope,
        tag: input.tag,
        digest: input.digest,
        now: new Date(),
      });
    } else {
      await setWorkerImageVersionStatus({
        versionId: input.versionId,
        status: input.status,
        scope: companyScope,
        now: new Date(),
      });
    }
    revalidatePath(`/companies/${companyId}/worker-images`);
    return { ok: true };
  } catch (error) {
    return { ok: false, formError: error instanceof Error ? error.message : "公司 Worker 镜像目录保存失败" };
  }
}
