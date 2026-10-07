import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  isWorkbenchSessionAuthenticated,
} from "../lib/workbench/workbench-auth-guard";
import {
  hasWorkbenchAuthenticationCookie,
  resolveWorkbenchSession,
} from "../lib/workbench/workbench-session";
import { PublicHome } from "./components/public-home";

export {
  HOME_PRIMARY_CTA_HREF,
  HOME_PRODUCT_MAP,
  HOME_REGISTER_HREF,
} from "./components/public-home";

export const metadata: Metadata = {
  title: "HumanThread | 人机协同交付工作台",
  description:
    "从 Space、项目、任务与文档，到 Agent/Loop 执行和人工确认，让每次交付沿着同一条线程推进。",
};

export default async function Home() {
  const cookieStore = await cookies();
  let session = null;
  const getCookieValue = (name: string) => cookieStore.get(name)?.value;
  const hasAuthenticationCookie = hasWorkbenchAuthenticationCookie(getCookieValue);

  if (hasAuthenticationCookie) {
    session = await resolveWorkbenchSession({ getCookieValue });
  }

  if (session && isWorkbenchSessionAuthenticated(session)) {
    redirect("/dashboard");
    return null;
  }

  return <PublicHome />;
}
