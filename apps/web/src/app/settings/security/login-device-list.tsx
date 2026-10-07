"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Laptop, LogOut, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { WebSessionSummary } from "../../../lib/workbench/web-session-store";
import type { WorkbenchSettingsActionState } from "../../workbench/actions";
import { revokeWorkbenchWebSessionAction } from "../../workbench/actions";
import { WorkbenchButton } from "../../components/workbench-ui";

const DATE_FORMAT = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function LoginDeviceList({
  currentSessionId,
  sessions,
  revokeAction = revokeWorkbenchWebSessionAction,
  refresh,
}: {
  currentSessionId: string;
  sessions: WebSessionSummary[];
  revokeAction?: (
    previousState: WorkbenchSettingsActionState,
    formData: FormData,
  ) => Promise<WorkbenchSettingsActionState>;
  refresh?: () => void;
}) {
  const router = useRouter();
  const [target, setTarget] = useState<WebSessionSummary | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function close() {
    if (pending) return;
    setTarget(null);
    setConfirmed(false);
    setError(null);
  }

  function submit() {
    if (!target || !confirmed || pending) return;
    const formData = new FormData();
    formData.set("webSessionId", target.id);
    startTransition(async () => {
      const result = await revokeAction({ ok: false }, formData);
      if (!result.ok) {
        setError(result.formError ?? "退出失败，请重试");
        return;
      }
      close();
      (refresh ?? router.refresh)();
    });
  }

  if (sessions.length === 0) {
    return <p className="text-sm text-[#57606a]">当前没有可管理的登录设备。</p>;
  }

  return (
    <>
      <div className="divide-y divide-[#d8dee4] border-y border-[#d8dee4]">
        {sessions.map((session) => {
          const current = session.id === currentSessionId;
          return (
            <div key={session.id} className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="flex min-w-0 items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-md bg-[#f6f8fa] text-[#57606a]">
                  <Laptop size={18} aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-[#24292f]">{session.deviceName}</span>
                    {current ? <span className="rounded-full bg-[#dafbe1] px-2 py-0.5 text-xs font-semibold text-[#116329]">当前设备</span> : null}
                  </div>
                  <p className="mt-1 text-sm text-[#57606a]">{session.browserName} · {session.operatingSystem}</p>
                  <p className="mt-1 text-xs leading-5 text-[#6e7781]">
                    最近活动 {DATE_FORMAT.format(session.lastSeenAt)} · 登录于 {DATE_FORMAT.format(session.createdAt)}
                  </p>
                </div>
              </div>
              {!current ? (
                <WorkbenchButton
                  type="button"
                  variant="danger"
                  size="small"
                  className="w-full sm:w-auto"
                  onClick={() => setTarget(session)}
                >
                  <LogOut size={14} aria-hidden="true" />
                  退出此设备
                </WorkbenchButton>
              ) : null}
            </div>
          );
        })}
      </div>
      <Dialog.Root open={Boolean(target)} onOpenChange={(open) => !open && close()}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-[#1f2328]/45" />
          <Dialog.Content className="fixed inset-x-4 top-1/2 z-50 -translate-y-1/2 rounded-lg border border-[#d0d7de] bg-white shadow-2xl outline-none sm:left-1/2 sm:w-[min(92vw,520px)] sm:-translate-x-1/2">
            <div className="flex items-start justify-between gap-4 border-b border-[#d8dee4] px-5 py-4">
              <div>
                <Dialog.Title className="text-base font-semibold text-[#24292f]">退出登录设备</Dialog.Title>
                <Dialog.Description className="mt-1 text-sm leading-5 text-[#57606a]">
                  {target ? `${target.deviceName} 上的 Web 登录将立即失效。` : ""}
                </Dialog.Description>
              </div>
              <Dialog.Close disabled={pending} className="grid size-8 place-items-center rounded-md hover:bg-[#f6f8fa]" aria-label="关闭退出登录设备">
                <X size={17} aria-hidden="true" />
              </Dialog.Close>
            </div>
            <div className="grid gap-3 px-5 py-5">
              <label className="flex items-center gap-2 text-sm font-medium text-[#24292f]">
                <input type="checkbox" checked={confirmed} disabled={pending} onChange={(event) => setConfirmed(event.target.checked)} />
                我已确认
              </label>
              {error ? <p role="alert" className="text-sm font-medium text-[#cf222e]">{error}</p> : null}
            </div>
            <div className="flex justify-end gap-2 border-t border-[#d8dee4] bg-[#fbfcfd] px-5 py-3">
              <WorkbenchButton type="button" variant="ghost" disabled={pending} onClick={close}>取消</WorkbenchButton>
              <WorkbenchButton type="button" variant="danger" disabled={!confirmed || pending} onClick={submit}>
                {pending ? "处理中" : "确认退出"}
              </WorkbenchButton>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
