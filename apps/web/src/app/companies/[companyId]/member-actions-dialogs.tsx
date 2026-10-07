"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useState, useTransition, type FormEvent } from "react";
import {
  inviteWorkbenchCompanyMemberAction,
  removeWorkbenchCompanyMemberAction,
  transferWorkbenchCompanyOwnershipAction,
  updateWorkbenchCompanyMemberRoleAction,
  type WorkbenchSettingsActionState,
} from "../../workbench/actions";
import { WorkbenchButton } from "../../components/workbench-ui";

type MemberActionType = "invite" | "role" | "remove" | "transfer";
type MemberAction = (
  previousState: WorkbenchSettingsActionState,
  formData: FormData,
) => Promise<WorkbenchSettingsActionState>;

export const COMPANY_MEMBER_ACTION_OPTIONS = ["invite", "role", "transfer", "remove"] as const;
export const COMPANY_MEMBER_ROLE_OPTIONS = ["member", "viewer", "admin"] as const;

interface CompanyMemberItem {
  id: string;
  role: string;
  user: { name: string };
}

const DEFAULT_ACTIONS = {
  invite: inviteWorkbenchCompanyMemberAction,
  role: updateWorkbenchCompanyMemberRoleAction,
  remove: removeWorkbenchCompanyMemberAction,
  transfer: transferWorkbenchCompanyOwnershipAction,
} satisfies Record<MemberActionType, MemberAction>;

const INPUT_CLASS = "h-10 rounded-md border border-[#8c959f] bg-white px-3 text-sm font-normal outline-none focus:border-[#0969da] focus:ring-4 focus:ring-[#0969da]/10 disabled:bg-[#f6f8fa]";

const ACTION_META: Record<MemberActionType, { title: string; description: string }> = {
  invite: { title: "邀请成员", description: "输入成员邮箱并指定其在当前公司的角色。" },
  role: { title: "设置角色", description: "角色变更只影响当前公司，不改变个人账号。" },
  remove: { title: "移除成员", description: "确认后该成员将失去当前公司的访问权限。" },
  transfer: { title: "转移 owner", description: "目标成员将成为 owner，当前 owner 将变为 admin。" },
};

export function CompanyMemberActionsDialogs({
  companyId,
  companyName,
  members,
  inviteDisabled,
  canTransferOwnership,
  actions = DEFAULT_ACTIONS,
}: {
  companyId: string;
  companyName: string;
  members: CompanyMemberItem[];
  inviteDisabled: boolean;
  canTransferOwnership: boolean;
  actions?: Record<MemberActionType, MemberAction>;
}) {
  const [openAction, setOpenAction] = useState<MemberActionType | null>(null);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [memberId, setMemberId] = useState(members[0]?.id ?? "");
  const [role, setRole] = useState("member");
  const [confirmation, setConfirmation] = useState("");
  const [state, setState] = useState<WorkbenchSettingsActionState>({ ok: false });
  const [pending, startTransition] = useTransition();

  function open(action: MemberActionType) {
    setState({ ok: false });
    setConfirmation("");
    setOpenAction(action);
  }

  function close() {
    if (!pending) {
      setOpenAction(null);
      setState({ ok: false });
    }
  }

  function submit(actionType: MemberActionType, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      const nextState = await actions[actionType](state, formData);
      setState(nextState);
      if (nextState.ok) {
        setOpenAction(null);
        setEmail("");
        setConfirmation("");
      }
    });
  }

  const meta = openAction ? ACTION_META[openAction] : null;
  const hasMembers = members.length > 0;

  return (
    <>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <WorkbenchButton type="button" size="small" variant="primary" onClick={() => open("invite")} disabled={inviteDisabled}>邀请成员</WorkbenchButton>
        <WorkbenchButton type="button" size="small" onClick={() => open("role")} disabled={!hasMembers}>设置角色</WorkbenchButton>
        {canTransferOwnership ? (
          <WorkbenchButton type="button" size="small" onClick={() => open("transfer")} disabled={!hasMembers}>转移 owner</WorkbenchButton>
        ) : null}
        <WorkbenchButton type="button" size="small" variant="danger" onClick={() => open("remove")} disabled={!hasMembers}>移除成员</WorkbenchButton>
      </div>

      <Dialog.Root open={Boolean(openAction)} onOpenChange={(next) => !next && close()}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-[#1f2328]/45" />
          <Dialog.Content className="fixed inset-x-4 top-1/2 z-50 max-h-[calc(100vh-32px)] -translate-y-1/2 overflow-y-auto rounded-lg border border-[#d0d7de] bg-white shadow-[0_24px_60px_rgba(31,35,40,0.24)] outline-none sm:left-1/2 sm:w-[min(92vw,560px)] sm:-translate-x-1/2">
            <div className="flex items-start gap-3 border-b border-[#d8dee4] px-5 py-4">
              <div className="min-w-0 flex-1">
                <Dialog.Title className="text-base font-semibold text-[#24292f]">{meta?.title}</Dialog.Title>
                <Dialog.Description className="mt-1 text-sm leading-5 text-[#57606a]">{meta?.description}</Dialog.Description>
              </div>
              <Dialog.Close disabled={pending} className="grid h-8 w-8 place-items-center rounded-md text-[#57606a] hover:bg-[#f6f8fa] disabled:opacity-50" aria-label={`关闭${meta?.title ?? "成员操作"}`}>
                <X size={17} aria-hidden="true" />
              </Dialog.Close>
            </div>

            {openAction ? (
              <form onSubmit={(event) => submit(openAction, event)} className="grid gap-4 px-5 py-5">
                <input type="hidden" name="companyId" value={companyId} />
                {openAction === "invite" ? (
                  <>
                    <label className="grid gap-1.5 text-sm font-semibold text-[#24292f]">成员邮箱
                      <input name="email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} disabled={pending} className={INPUT_CLASS} />
                    </label>
                    <label className="grid gap-1.5 text-sm font-semibold text-[#24292f]">成员角色
                      <select name="role" value={inviteRole} onChange={(event) => setInviteRole(event.target.value)} disabled={pending} className={INPUT_CLASS}>
                        {COMPANY_MEMBER_ROLE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                    </label>
                  </>
                ) : (
                  <label className="grid gap-1.5 text-sm font-semibold text-[#24292f]">{openAction === "transfer" ? "新 owner" : "成员"}
                    <select name={openAction === "transfer" ? "targetMemberId" : "memberId"} value={memberId} onChange={(event) => setMemberId(event.target.value)} disabled={pending} className={INPUT_CLASS}>
                      {members.map((member) => <option key={member.id} value={member.id}>{member.user.name} · {member.role}</option>)}
                    </select>
                  </label>
                )}
                {openAction === "role" ? (
                  <label className="grid gap-1.5 text-sm font-semibold text-[#24292f]">角色
                    <select name="role" value={role} onChange={(event) => setRole(event.target.value)} disabled={pending} className={INPUT_CLASS}>
                      {COMPANY_MEMBER_ROLE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </label>
                ) : null}
                {openAction === "transfer" ? (
                  <div className="grid gap-1.5">
                    <label htmlFor="company-owner-confirmation" className="text-sm font-semibold text-[#24292f]">输入公司名称确认</label>
                    <input id="company-owner-confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={pending} className={INPUT_CLASS} />
                    <span className="text-xs font-normal text-[#57606a]">请输入 {companyName}</span>
                  </div>
                ) : null}
                {state.formError ? <div role="alert" className="text-sm font-medium text-[#cf222e]">{state.formError}</div> : null}
                <div className="flex justify-end gap-2 border-t border-[#d8dee4] pt-4">
                  <WorkbenchButton type="button" variant="ghost" disabled={pending} onClick={close}>取消</WorkbenchButton>
                  <WorkbenchButton
                    type="submit"
                    variant={openAction === "remove" || openAction === "transfer" ? "danger" : "primary"}
                    disabled={pending || (openAction === "transfer" && confirmation !== companyName)}
                  >
                    {pending
                      ? "处理中"
                      : openAction === "remove"
                        ? "确认移除成员"
                        : openAction === "transfer"
                          ? "确认转移 owner"
                          : meta?.title}
                  </WorkbenchButton>
                </div>
              </form>
            ) : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
