"use client";

import { useState, useTransition, type FormEvent } from "react";
import {
  updateWorkbenchCompanyMailSettingsAction,
  type WorkbenchSettingsActionState,
} from "../../../workbench/actions";
import { SettingsFormActions } from "../../../components/settings-form";

interface CompanyMailSettings {
  emailHost: string | null;
  emailPort: number | null;
  emailUsername: string | null;
  hasPassword: boolean;
}

const INITIAL_STATE: WorkbenchSettingsActionState = { ok: false };
const INPUT_CLASS = "h-10 rounded-md border border-[#8c959f] bg-white px-3 text-sm font-normal outline-none focus:border-[#0969da] focus:ring-4 focus:ring-[#0969da]/10";

export function CompanyMailForm({
  companyId,
  initial,
  action = updateWorkbenchCompanyMailSettingsAction,
}: {
  companyId: string;
  initial: CompanyMailSettings;
  action?: (
    previousState: WorkbenchSettingsActionState,
    formData: FormData,
  ) => Promise<WorkbenchSettingsActionState>;
}) {
  const initialValues = {
    host: initial.emailHost ?? "",
    port: initial.emailPort?.toString() ?? "",
    username: initial.emailUsername ?? "",
  };
  const [saved, setSaved] = useState(initialValues);
  const [host, setHost] = useState(initialValues.host);
  const [port, setPort] = useState(initialValues.port);
  const [username, setUsername] = useState(initialValues.username);
  const [password, setPassword] = useState("");
  const [state, setState] = useState(INITIAL_STATE);
  const [pending, startTransition] = useTransition();
  const dirty = host !== saved.host || port !== saved.port || username !== saved.username || Boolean(password);

  function cancel() {
    setHost(saved.host);
    setPort(saved.port);
    setUsername(saved.username);
    setPassword("");
    setState(INITIAL_STATE);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      const nextState = await action(state, formData);
      setState(nextState);
      if (nextState.ok) {
        setSaved({ host, port, username });
        setPassword("");
      }
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-4 md:max-w-2xl">
      <input type="hidden" name="companyId" value={companyId} />
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_140px]">
        <label className="grid gap-1.5 text-sm font-semibold text-[#24292f]">服务器地址
          <input name="emailHost" value={host} onChange={(event) => setHost(event.target.value)} placeholder="smtp.example.com" className={INPUT_CLASS} />
        </label>
        <label className="grid gap-1.5 text-sm font-semibold text-[#24292f]">端口
          <input name="emailPort" inputMode="numeric" value={port} onChange={(event) => setPort(event.target.value)} placeholder="465" className={INPUT_CLASS} />
        </label>
      </div>
      <label className="grid gap-1.5 text-sm font-semibold text-[#24292f]">用户名
        <input name="emailUsername" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" placeholder="noreply@example.com" className={INPUT_CLASS} />
      </label>
      <div className="grid gap-1.5">
        <label htmlFor="company-mail-password" className="text-sm font-semibold text-[#24292f]">密码</label>
        <input
          id="company-mail-password"
          name="emailPassword"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="new-password"
          placeholder={initial.hasPassword ? "已配置，留空保留现有密码" : "输入邮件服务器密码"}
          className={INPUT_CLASS}
        />
        <span className="text-xs font-normal text-[#57606a]">密码不会回显；留空不会清除已保存的密码。</span>
      </div>
      <SettingsFormActions
        dirty={dirty}
        pending={pending}
        onCancel={cancel}
        saveLabel="保存邮件集成"
        {...(state.ok ? { successMessage: "邮件集成已保存" } : {})}
        {...(state.formError ? { errorMessage: state.formError } : {})}
      />
    </form>
  );
}
