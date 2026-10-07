import Link from "next/link";
import {
  getSingleWorkbenchAuthParam,
  getWorkbenchAuthErrorMessage,
  normalizeWorkbenchRedirectPath,
  type WorkbenchLoginSearchParams,
} from "../../lib/workbench/workbench-auth-guard";
import { registerWorkbenchAction } from "../workbench/actions";
import { RegistrationVerificationButton } from "./registration-verification-button";

export const dynamic = "force-dynamic";

interface RegisterPageProps {
  searchParams?: Promise<WorkbenchLoginSearchParams>;
}

export const REGISTER_DEFAULT_REDIRECT_TO = "/dashboard";

export const REGISTER_PROOF_POINTS = [
  "两种入口都创建同一种个人账号",
  "公司是组织，不是登录账号",
  "以后仍可创建或加入更多公司",
] as const;

export const REGISTER_ERROR_LABEL = "注册失败";

export default async function RegisterPage({ searchParams }: RegisterPageProps) {
  const resolvedSearchParams = await searchParams;
  const normalizedRedirectTo = normalizeWorkbenchRedirectPath(
    getSingleWorkbenchAuthParam(resolvedSearchParams?.redirectTo),
  );
  const redirectTo =
    normalizedRedirectTo === "/"
      ? REGISTER_DEFAULT_REDIRECT_TO
      : normalizedRedirectTo;
  const errorMessage = getWorkbenchAuthErrorMessage(
    resolvedSearchParams?.error,
  );
  return (
    <main className="min-h-screen overflow-hidden bg-[#0d1117] text-[#f0f6fc]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(63,185,80,0.32),transparent_28%),radial-gradient(circle_at_80%_14%,rgba(88,166,255,0.24),transparent_24%),linear-gradient(135deg,#0d1117_0%,#111b16_45%,#101822_100%)]" />
      <div className="absolute inset-0 opacity-[0.18] [background-image:linear-gradient(rgba(240,246,252,0.18)_1px,transparent_1px),linear-gradient(90deg,rgba(240,246,252,0.18)_1px,transparent_1px)] [background-size:44px_44px]" />

      <section className="relative mx-auto grid min-h-screen max-w-6xl items-center gap-10 px-5 py-8 lg:grid-cols-[minmax(0,1fr)_430px] lg:px-10">
        <div className="max-w-2xl">
          <Link
            href="/login"
            className="inline-flex rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold text-white shadow-sm backdrop-blur"
          >
            HumanThread
          </Link>
          <p className="mt-8 text-sm font-semibold uppercase tracking-[0.3em] text-[#7ee787]">
            Open Registration
          </p>
          <h1 className="mt-4 text-5xl font-semibold tracking-[-0.055em] text-white sm:text-6xl">
            先创建个人身份，再选择工作方式
          </h1>
          <p className="mt-5 text-lg leading-8 text-[#c9d1d9]">
            每个人都拥有独立账号与个人空间。你可以直接个人使用，也可以在注册时创建公司并成为首位 owner。
          </p>
          <div className="mt-8 grid gap-3">
            {REGISTER_PROOF_POINTS.map((point) => (
              <div
                key={point}
                className="rounded-2xl border border-white/10 bg-white/[0.06] p-4 text-sm text-[#d0d7de] shadow-xl shadow-black/20 backdrop-blur"
              >
                {point}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[28px] border border-white/15 bg-[#f6f8fa] p-2 text-[#24292f] shadow-[0_32px_90px_rgba(0,0,0,0.48)]">
          <div className="rounded-[22px] border border-[#d0d7de] bg-white">
            <div className="border-b border-[#d8dee4] bg-[#f6f8fa] px-6 py-5">
              <div className="inline-flex rounded-full border border-[#d0d7de] bg-white px-3 py-1 text-xs font-semibold text-[#57606a]">
                注册新账号
              </div>
              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-[#24292f]">
                开始使用工作台
              </h2>
              <p className="mt-2 text-sm leading-6 text-[#57606a]">
                使用邮箱和密码创建账号。注册成功后会自动登录。
              </p>
            </div>
            <form action={registerWorkbenchAction} className="space-y-4 p-6">
              <input type="hidden" name="redirectTo" value={redirectTo} />
              {errorMessage ? (
                <div
                  role="alert"
                  className="rounded-xl border border-[#f1aeb5] bg-[#fff5f5] p-4 text-sm leading-6 text-[#cf222e]"
                >
                  <div className="font-semibold text-[#82071e]">
                    {REGISTER_ERROR_LABEL}
                  </div>
                  <div className="mt-1">{errorMessage}</div>
                </div>
              ) : null}
              <fieldset className="grid gap-2">
                <legend className="text-sm font-semibold text-[#24292f]">使用方式</legend>
                <div className="grid grid-cols-2 gap-2">
                  <label className="grid cursor-pointer gap-1 rounded-lg border border-[#d0d7de] bg-white p-3 text-sm has-[:checked]:border-[#0969da] has-[:checked]:bg-[#ddf4ff]">
                    <span className="flex items-center gap-2 font-semibold text-[#24292f]">
                      <input
                        type="radio"
                        name="accountType"
                        value="personal"
                        defaultChecked
                        className="h-4 w-4 accent-[#0969da]"
                      />
                      个人使用
                    </span>
                    <span className="pl-6 text-xs leading-5 text-[#57606a]">
                      创建个人空间，稍后再加入公司。
                    </span>
                  </label>
                  <label className="grid cursor-pointer gap-1 rounded-lg border border-[#d0d7de] bg-white p-3 text-sm has-[:checked]:border-[#0969da] has-[:checked]:bg-[#ddf4ff]">
                    <span className="flex items-center gap-2 font-semibold text-[#24292f]">
                      <input
                        type="radio"
                        name="accountType"
                        value="company"
                        className="h-4 w-4 accent-[#0969da]"
                      />
                      创建公司
                    </span>
                    <span className="pl-6 text-xs leading-5 text-[#57606a]">
                      同时创建公司空间并成为 owner。
                    </span>
                  </label>
                </div>
              </fieldset>
              <label className="grid gap-2 text-sm font-semibold text-[#24292f]">
                公司名称
                <input
                  type="text"
                  name="companyName"
                  autoComplete="organization"
                  placeholder="仅选择创建公司时填写"
                  className="rounded-xl border border-[#d0d7de] bg-white px-4 py-3 text-sm font-normal outline-none transition focus:border-[#0969da] focus:ring-4 focus:ring-[#0969da]/10"
                />
                <span className="text-xs font-normal leading-5 text-[#57606a]">
                  个人使用模式可留空；公司不会获得独立登录凭据。
                </span>
              </label>
              <label className="grid gap-2 text-sm font-semibold text-[#24292f]">
                昵称
                <input
                  type="text"
                  name="name"
                  required
                  autoComplete="name"
                  placeholder="Alice"
                  className="rounded-xl border border-[#d0d7de] bg-white px-4 py-3 text-sm font-normal outline-none transition focus:border-[#0969da] focus:ring-4 focus:ring-[#0969da]/10"
                />
              </label>
              <label className="grid gap-2 text-sm font-semibold text-[#24292f]">
                登录邮箱
                <input
                  type="email"
                  name="email"
                  required
                  autoComplete="email"
                  placeholder="alice@example.com"
                  className="rounded-xl border border-[#d0d7de] bg-white px-4 py-3 text-sm font-normal outline-none transition focus:border-[#0969da] focus:ring-4 focus:ring-[#0969da]/10"
                />
              </label>
              <label className="grid gap-2 text-sm font-semibold text-[#24292f]">
                邮箱验证码
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px]">
                  <input
                    type="text"
                    name="verificationCode"
                    required
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    placeholder="6 位验证码"
                    className="rounded-xl border border-[#d0d7de] bg-white px-4 py-3 text-sm font-normal outline-none transition focus:border-[#0969da] focus:ring-4 focus:ring-[#0969da]/10"
                  />
                  <RegistrationVerificationButton />
                </div>
              </label>
              <label className="grid gap-2 text-sm font-semibold text-[#24292f]">
                登录密码
                <input
                  type="password"
                  name="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  placeholder="至少 8 位"
                  className="rounded-xl border border-[#d0d7de] bg-white px-4 py-3 text-sm font-normal outline-none transition focus:border-[#0969da] focus:ring-4 focus:ring-[#0969da]/10"
                />
              </label>
              <button
                type="submit"
                className="w-full rounded-xl border border-[#1f883d] bg-[#1f883d] px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1a7f37]"
              >
                注册并进入工作台
              </button>
              <div className="text-center text-xs text-[#57606a]">
                已有账号？
                <Link
                  href={`/login?redirectTo=${encodeURIComponent(redirectTo)}`}
                  className="font-semibold text-[#0969da] hover:underline"
                >
                  返回登录
                </Link>
              </div>
            </form>
          </div>
        </div>
      </section>
    </main>
  );
}
