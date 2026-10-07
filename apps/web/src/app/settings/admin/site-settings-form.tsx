"use client";

import { useState, useTransition, type FormEvent } from "react";
import {
  updateWorkbenchSiteSettingsAction,
  type WorkbenchSettingsActionState,
} from "../../workbench/actions";
import { SettingsFormActions } from "../../components/settings-form";

const INITIAL_STATE: WorkbenchSettingsActionState = { ok: false };

export function SiteSettingsForm({
  initialSiteBaseUrl,
  mcpUrl,
  action = updateWorkbenchSiteSettingsAction,
}: {
  initialSiteBaseUrl: string;
  mcpUrl: string;
  action?: (
    previousState: WorkbenchSettingsActionState,
    formData: FormData,
  ) => Promise<WorkbenchSettingsActionState>;
}) {
  const [savedUrl, setSavedUrl] = useState(initialSiteBaseUrl);
  const [siteBaseUrl, setSiteBaseUrl] = useState(initialSiteBaseUrl);
  const [state, setState] = useState(INITIAL_STATE);
  const [pending, startTransition] = useTransition();
  const dirty = siteBaseUrl.trim() !== savedUrl.trim();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const nextState = await action(state, formData);
      setState(nextState);
      if (nextState.ok) setSavedUrl(siteBaseUrl.trim());
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-4 md:max-w-2xl">
      <label className="grid gap-1.5 text-sm font-semibold text-[#24292f]">
        站点域名
        <input
          type="url"
          name="siteBaseUrl"
          required
          value={siteBaseUrl}
          onChange={(event) => setSiteBaseUrl(event.target.value)}
          className="h-10 rounded-md border border-[#8c959f] bg-white px-3 text-sm font-normal outline-none focus:border-[#0969da] focus:ring-4 focus:ring-[#0969da]/10"
        />
      </label>
      <div className="grid gap-2 rounded-md border border-[#d0d7de] bg-[#f6f8fa] px-4 py-3 text-sm leading-6 text-[#57606a]">
        <div>MCP 地址：<code className="break-all text-[#24292f]">{mcpUrl}</code></div>
        <div>Agent 默认 API Base URL：<code className="break-all text-[#24292f]">{savedUrl}</code></div>
      </div>
      <SettingsFormActions
        dirty={dirty}
        pending={pending}
        onCancel={() => {
          setSiteBaseUrl(savedUrl);
          setState(INITIAL_STATE);
        }}
        saveLabel="保存站点配置"
        {...(state.ok ? { successMessage: "站点配置已保存" } : {})}
        {...(state.formError ? { errorMessage: state.formError } : {})}
      />
    </form>
  );
}
