import { redirect } from "next/navigation";
import { requireWorkbenchSession } from "../../../lib/workbench/workbench-route-auth";
import { getWorkbenchCompanySettingsContext } from "../../../lib/workbench/workbench-settings-context";

export const dynamic = "force-dynamic";

interface MemberSettingsPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

const EMPTY_SEARCH_PARAMS: Record<string, string | string[] | undefined> = {};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function MemberSettingsPage({
  searchParams,
}: MemberSettingsPageProps = {}) {
  const { session } = await requireWorkbenchSession("/settings/members");
  const resolvedSearchParams = await (searchParams ?? Promise.resolve(EMPTY_SEARCH_PARAMS));
  const companyId = firstParam(resolvedSearchParams.companyId)?.trim();

  if (!companyId) {
    redirect("/settings/companies?intent=members");
  }

  const context = await getWorkbenchCompanySettingsContext({
    userId: session.context.userId,
    companyId,
  });

  if (!context) {
    redirect("/settings/companies?intent=members");
  }

  redirect(`/companies/${companyId}/members`);
}
