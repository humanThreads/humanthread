import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  hasWorkbenchAuthenticationCookie,
  resolveWorkbenchSession,
} from "../../lib/workbench/workbench-session";
import {
  getSingleWorkbenchAuthParam,
  getWorkbenchAuthErrorMessage,
  isWorkbenchSessionAuthenticated,
  normalizeWorkbenchRedirectPath,
  type WorkbenchLoginSearchParams,
} from "../../lib/workbench/workbench-auth-guard";
import { MotionReveal } from "../components/motion-reveal";
import { loginWorkbenchAction } from "../workbench/actions";

export const dynamic = "force-dynamic";
export const LOGIN_DEFAULT_REDIRECT_TO = "/dashboard";
export const LOGIN_REGISTER_HREF = `/register?redirectTo=${encodeURIComponent(LOGIN_DEFAULT_REDIRECT_TO)}`;
export const LOGIN_ERROR_LABEL = "登录失败";
export const LOGIN_EMAIL_PLACEHOLDER = "请输入登录邮箱";
export const LOGIN_SURFACE_COPY = {
  title: "登录 HumanThread",
  note: "会话只在当前账号与可访问 Space 内生效。",
} as const;

interface LoginPageProps {
  searchParams?: Promise<WorkbenchLoginSearchParams>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const resolvedSearchParams = await searchParams;
  const normalizedRedirectTo = normalizeWorkbenchRedirectPath(
    getSingleWorkbenchAuthParam(resolvedSearchParams?.redirectTo),
  );
  const redirectTo = normalizedRedirectTo === "/"
    ? LOGIN_DEFAULT_REDIRECT_TO
    : normalizedRedirectTo;
  const registerHref = `/register?redirectTo=${encodeURIComponent(redirectTo)}`;
  const errorMessage = getWorkbenchAuthErrorMessage(resolvedSearchParams?.error);
  const cookieStore = await cookies();
  let session;
  const getCookieValue = (name: string) => cookieStore.get(name)?.value;

  if (hasWorkbenchAuthenticationCookie(getCookieValue)) {
    session = await resolveWorkbenchSession({ getCookieValue });
  }

  if (session && isWorkbenchSessionAuthenticated(session)) redirect(redirectTo);

  return (
    <main className="grid min-h-screen place-items-center bg-[#f6f8fa] px-4 py-6 text-[#24292f] sm:px-5">
      <MotionReveal motionKey="login-surface" className="w-full max-w-[420px]">
        <section className="border border-[#d0d7de] bg-white shadow-[0_18px_44px_rgba(31,35,40,0.12)]">
          <header className="border-b border-[#d8dee4] px-5 py-5 sm:px-6">
            <Link href="/" className="text-sm font-semibold text-[#0969da]">HumanThread</Link>
            <h1 className="mt-4 text-2xl font-semibold">{LOGIN_SURFACE_COPY.title}</h1>
            <p className="mt-2 text-sm leading-6 text-[#57606a]">进入项目、任务、文档与 Agent 协作工作台。</p>
          </header>
          <form action={loginWorkbenchAction} className="grid gap-4 px-5 py-5 sm:px-6 sm:py-6">
            <input type="hidden" name="redirectTo" value={redirectTo} />
            {errorMessage ? <div role="alert" className="border border-[#f1aeb5] bg-[#fff5f5] p-3 text-sm text-[#cf222e]"><div className="font-semibold">{LOGIN_ERROR_LABEL}</div><div className="mt-1">{errorMessage}</div></div> : null}
            <label className="grid gap-1.5 text-sm font-semibold">登录邮箱
              <input type="email" name="email" required autoComplete="email" placeholder={LOGIN_EMAIL_PLACEHOLDER} className="h-10 border border-[#8c959f] px-3 text-sm font-normal outline-none focus:border-[#0969da]" />
            </label>
            <label className="grid gap-1.5 text-sm font-semibold">登录密码
              <input type="password" name="password" required autoComplete="current-password" placeholder="输入密码" className="h-10 border border-[#8c959f] px-3 text-sm font-normal outline-none focus:border-[#0969da]" />
            </label>
            <button type="submit" className="h-10 border border-[#1f883d] bg-[#1f883d] text-sm font-semibold text-white hover:bg-[#1a7f37]">登录并进入工作台</button>
            <p className="border-l-2 border-[#0969da] bg-[#ddf4ff] px-3 py-2 text-xs leading-5 text-[#0a3069]">{LOGIN_SURFACE_COPY.note}</p>
            <p className="text-center text-sm text-[#57606a]">还没有账号？ <Link href={registerHref} className="font-semibold text-[#0969da]">创建账号</Link></p>
          </form>
        </section>
      </MotionReveal>
    </main>
  );
}
