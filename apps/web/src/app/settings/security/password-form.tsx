"use client";

import { useState, useTransition, type FormEvent } from "react";
import {
  changeWorkbenchPasswordStateAction,
  type WorkbenchSettingsActionState,
} from "../../workbench/actions";
import { SettingsFormActions } from "../../components/settings-form";

const INITIAL_STATE: WorkbenchSettingsActionState = { ok: false };
const INPUT_CLASS = "h-10 rounded-md border border-[#8c959f] bg-white px-3 text-sm font-normal outline-none focus:border-[#0969da] focus:ring-4 focus:ring-[#0969da]/10";

export function PasswordForm({
  action = changeWorkbenchPasswordStateAction,
}: {
  action?: (
    previousState: WorkbenchSettingsActionState,
    formData: FormData,
  ) => Promise<WorkbenchSettingsActionState>;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [state, setState] = useState(INITIAL_STATE);
  const [pending, startTransition] = useTransition();
  const dirty = Boolean(currentPassword || newPassword || confirmPassword);

  function clear() {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      const nextState = await action(state, formData);
      setState(nextState);
      if (nextState.ok) {
        clear();
      }
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-4 md:max-w-xl">
      <label className="grid gap-1.5 text-sm font-semibold text-[#24292f]">
        当前密码
        <input
          type="password"
          name="currentPassword"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          className={INPUT_CLASS}
        />
        {state.fieldErrors?.currentPassword ? <span role="alert" className="text-xs text-[#cf222e]">{state.fieldErrors.currentPassword}</span> : null}
      </label>
      <label className="grid gap-1.5 text-sm font-semibold text-[#24292f]">
        新密码
        <input
          type="password"
          name="newPassword"
          minLength={8}
          autoComplete="new-password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          className={INPUT_CLASS}
        />
        {state.fieldErrors?.newPassword ? <span role="alert" className="text-xs text-[#cf222e]">{state.fieldErrors.newPassword}</span> : null}
      </label>
      <label className="grid gap-1.5 text-sm font-semibold text-[#24292f]">
        确认新密码
        <input
          type="password"
          name="confirmPassword"
          minLength={8}
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          className={INPUT_CLASS}
        />
        {state.fieldErrors?.confirmPassword ? <span role="alert" className="text-xs text-[#cf222e]">{state.fieldErrors.confirmPassword}</span> : null}
      </label>
      <SettingsFormActions
        dirty={dirty}
        pending={pending}
        onCancel={clear}
        saveLabel="保存新密码"
        {...(state.ok ? { successMessage: "密码已更新，其他设备已退出登录" } : {})}
        {...(state.formError ? { errorMessage: state.formError } : {})}
      />
    </form>
  );
}
