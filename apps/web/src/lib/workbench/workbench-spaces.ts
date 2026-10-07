import {
  listAccessibleSpaces,
  type AccessibleSpace,
} from "../../../../../packages/db/src/index";
import type { WorkbenchCompanyFilter } from "./workbench-companies";

export type WorkbenchSpace = AccessibleSpace;

export async function listWorkbenchSpaces(input: {
  userId: string;
  db?: Parameters<typeof listAccessibleSpaces>[0]["db"];
}): Promise<WorkbenchSpace[]> {
  const spaces = await listAccessibleSpaces({
    userId: input.userId,
    ...(input.db ? { db: input.db } : {}),
  });

  return [...spaces].sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === "personal" ? -1 : 1;
    }

    return left.name.localeCompare(right.name);
  });
}

export function selectWorkbenchRootDocumentSpaceId(
  spaces: WorkbenchSpace[],
  filter: WorkbenchCompanyFilter,
): string | undefined {
  if (filter.ownerType === "personal") {
    return spaces.find((space) => space.type === "personal")?.id;
  }

  if (filter.ownerType === "company" && filter.companyId) {
    return spaces.find(
      (space) => space.type === "company" && space.companyId === filter.companyId,
    )?.id;
  }

  return undefined;
}
