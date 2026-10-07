import { listAccessibleSpaces } from "../../../../../packages/db/src/index";

export interface WorkbenchCompanyFilter {
  key: string;
  label: string;
  companyId: string | null;
  ownerType: "company" | "personal" | null;
  spaceId?: string | null;
  role?: "owner" | "admin" | "member" | "viewer" | null;
}

export interface GetWorkbenchCompanyFiltersInput {
  userId: string;
  db?: Parameters<typeof listAccessibleSpaces>[0]["db"];
}

export function buildWorkbenchCompanyFiltersCacheTag(userId: string) {
  return `workbench:company-filters:${userId}`;
}

export async function getWorkbenchCompanyFilters(
  input: GetWorkbenchCompanyFiltersInput,
): Promise<WorkbenchCompanyFilter[]> {
  const spaces = await listAccessibleSpaces({
    userId: input.userId,
    ...(input.db ? { db: input.db } : {}),
  });
  const personal = spaces.find((space) => space.type === "personal");
  const companies = spaces.filter((space) => space.type === "company" && space.companyId);

  return [
    {
      key: "all",
      label: "全部",
      companyId: null,
      ownerType: null,
      spaceId: null,
      role: null,
    },
    {
      key: "personal",
      label: "个人空间",
      companyId: null,
      ownerType: "personal",
      spaceId: personal?.id ?? null,
      role: personal?.role ?? null,
    },
    ...companies.map((space) => ({
      key: space.companyId!,
      label: space.name,
      companyId: space.companyId,
      ownerType: "company" as const,
      spaceId: space.id,
      role: space.role,
    })),
  ];
}
