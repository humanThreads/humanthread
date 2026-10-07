"use client";

import type { WorkbenchMcpCredentialSettings } from "../../../lib/workbench/workbench-settings";
import {
  revokeWorkbenchMcpCredentialAction,
  type WorkbenchSettingsActionState,
} from "../../workbench/actions";
import { DangerConfirmDialog } from "../../components/settings-dialog";
import { formatWorkbenchDateTime } from "../../components/workbench-sections";
import { StatusPill } from "../../components/workbench-ui";

export function McpCredentialList({
  credentials,
  revokeAction = revokeWorkbenchMcpCredentialAction,
}: {
  credentials: WorkbenchMcpCredentialSettings[];
  revokeAction?: (credentialId: string) => Promise<WorkbenchSettingsActionState>;
}) {
  if (credentials.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-[#d0d7de] bg-[#f6f8fa] px-4 py-5 text-sm text-[#57606a]">
        暂无 MCP 凭据。
      </div>
    );
  }

  return (
    <div className="divide-y divide-[#d8dee4]">
      {credentials.map((credential) => {
        const active = credential.status === "active" && !credential.revokedAt;

        return (
          <div key={credential.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-[#24292f]">{credential.name}</div>
              <div className="mt-1 text-xs leading-5 text-[#57606a]">
                创建于 {formatWorkbenchDateTime(credential.createdAt)} · 最近使用 {formatWorkbenchDateTime(credential.lastUsedAt)}
              </div>
            </div>
            <StatusPill tone={active ? "success" : "default"}>{active ? "有效" : "已撤销"}</StatusPill>
            {active ? (
              <DangerConfirmDialog
                triggerLabel={`撤销 ${credential.name}`}
                title={`撤销 ${credential.name}`}
                description={`撤销后 ${credential.name} 将无法继续访问 HumanThread，已发出的 token 会立即失效。`}
                actionLabel="确认撤销"
                onConfirm={async () => {
                  const result = await revokeAction(credential.id);
                  if (!result.ok) {
                    throw new Error(result.formError ?? "MCP 凭据撤销失败");
                  }
                }}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
