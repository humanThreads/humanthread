"use client";

import { useActionState } from "react";
import {
  issueWorkbenchMcpCredentialAction,
  type IssueWorkbenchMcpCredentialState,
} from "../../workbench/actions";
import { Callout, WorkbenchButton } from "../../components/workbench-ui";

const INITIAL_STATE: IssueWorkbenchMcpCredentialState = {
  ok: false,
};

export function McpCredentialForm() {
  const [state, action, isPending] = useActionState(
    issueWorkbenchMcpCredentialAction,
    INITIAL_STATE,
  );

  return (
    <form action={action} className="grid gap-3">
      <label className="grid gap-2 text-sm font-semibold text-[#24292f]">
        凭据名称
        <input
          name="name"
          placeholder="Codex"
          className="rounded-md border border-[#d0d7de] bg-white px-3 py-2 text-sm font-normal outline-none focus:border-[#0969da]"
        />
      </label>
      <WorkbenchButton type="submit" variant="primary" disabled={isPending}>
        {isPending ? "生成中" : "生成凭据"}
      </WorkbenchButton>
      {state.ok && state.token ? (
        <Callout title="Token 只显示一次">
          <code className="break-all font-mono">{state.token}</code>
        </Callout>
      ) : null}
      {!state.ok && state.error ? (
        <div className="rounded-md border border-[#f1aeb5] bg-[#fff5f5] p-3 text-sm text-[#cf222e]">
          {state.error}
        </div>
      ) : null}
    </form>
  );
}
