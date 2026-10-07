import type { WorkbenchCompanyFilter } from "./workbench-companies";

export const PROJECT_SPACE_SEARCH_PARAM = "space";
export const WORKBENCH_SPACE_COOKIE = "ht_workbench_space";

const DEFAULT_PROJECT_SPACE_FILTER: WorkbenchCompanyFilter = {
  key: "all",
  label: "全部",
  companyId: null,
  ownerType: null,
};

export type WorkbenchSearchParams = Record<
  string,
  string | string[] | undefined
>;

export function getSingleWorkbenchSearchParam(
  searchParams: WorkbenchSearchParams | undefined,
  key: string,
): string | undefined {
  const value = searchParams?.[key];

  return Array.isArray(value) ? value[0] : value;
}

export function getPreferredWorkbenchSpaceKey(input: {
  searchParamValue: string | undefined;
  cookieValue: string | undefined;
}): string | undefined {
  const selectedFromSearch = input.searchParamValue?.trim();

  if (selectedFromSearch) {
    return selectedFromSearch;
  }

  const selectedFromCookie = input.cookieValue?.trim();

  return selectedFromCookie || undefined;
}

export function selectWorkbenchProjectSpaceFilter(
  filters: WorkbenchCompanyFilter[],
  selectedKey: string | undefined,
): WorkbenchCompanyFilter {
  return (
    filters.find((filter) => filter.key === selectedKey) ??
    filters.find((filter) => filter.key === "all") ??
    DEFAULT_PROJECT_SPACE_FILTER
  );
}

export function getWorkbenchSelectedSpaceFilter(input: {
  filters: WorkbenchCompanyFilter[];
  searchParamValue?: string | undefined;
  cookieValue?: string | undefined;
}): WorkbenchCompanyFilter {
  return selectWorkbenchProjectSpaceFilter(
    input.filters,
    getPreferredWorkbenchSpaceKey({
      searchParamValue: input.searchParamValue,
      cookieValue: input.cookieValue,
    }),
  );
}

export function getWorkbenchSpaceFiltersForMenu(input: {
  userCompanyFilters: WorkbenchCompanyFilter[];
}): WorkbenchCompanyFilter[] {
  const filters = [
    {
      key: "all",
      label: "全部",
      companyId: null,
      ownerType: null,
    },
    {
      key: "personal",
      label: "个人空间",
      companyId: null,
      ownerType: "personal" as const,
    },
    ...input.userCompanyFilters,
  ];

  return filters.filter(
    (filter, index, allFilters) =>
      allFilters.findIndex((candidate) => candidate.key === filter.key) === index,
  );
}

export function getWorkbenchMenuSelectedSpaceKey(input: {
  filters: WorkbenchCompanyFilter[];
  selectedKey: string | undefined;
}): string {
  if (input.selectedKey && input.filters.some((filter) => filter.key === input.selectedKey)) {
    return input.selectedKey;
  }

  return input.filters[0]?.key ?? "all";
}

export function buildWorkbenchSpaceHref(
  pathname: string,
  filter: WorkbenchCompanyFilter,
): string {
  if (filter.key === "all") {
    return pathname;
  }

  return `${pathname}?${PROJECT_SPACE_SEARCH_PARAM}=${encodeURIComponent(
    filter.key,
  )}`;
}
