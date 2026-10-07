"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import {
  createWorkbenchCompanyAction,
  type WorkbenchSettingsActionState,
} from "../../workbench/actions";
import { SettingsDialog } from "../../components/settings-dialog";
import { WorkbenchButton } from "../../components/workbench-ui";

const INITIAL_STATE: WorkbenchSettingsActionState = { ok: false };

export function CompanyCreateDialog({
  action = createWorkbenchCompanyAction,
}: {
  action?: (
    previousState: WorkbenchSettingsActionState,
    formData: FormData,
  ) => Promise<WorkbenchSettingsActionState>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [state, setState] = useState(INITIAL_STATE);
  const [pending, startTransition] = useTransition();

  function setDialogOpen(next: boolean) {
    if (pending) return;
    setOpen(next);
    if (!next) {
      setName("");
      setState(INITIAL_STATE);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      const nextState = await action(state, formData);
      setState(nextState);
      if (nextState.ok && nextState.companyId) {
        setOpen(false);
        setName("");
        router.push(`/companies/${nextState.companyId}`);
      }
    });
  }

  return (
    <SettingsDialog
      triggerLabel="创建公司"
      title="创建公司"
      description="创建独立的公司空间并成为首位 owner。公司与个人账号始终保持独立。"
      open={open}
      onOpenChange={setDialogOpen}
    >
      <form onSubmit={submit} className="grid gap-4">
        <label className="grid gap-1.5 text-sm font-semibold text-[#24292f]">
          公司名称
          <input
            name="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={pending}
            autoFocus
            aria-invalid={Boolean(state.fieldErrors?.name)}
            className="h-10 rounded-md border border-[#8c959f] bg-white px-3 text-sm font-normal outline-none focus:border-[#0969da] focus:ring-4 focus:ring-[#0969da]/10 disabled:bg-[#f6f8fa]"
          />
          {state.fieldErrors?.name ? <span role="alert" className="text-xs font-medium text-[#cf222e]">{state.fieldErrors.name}</span> : null}
        </label>
        {state.formError ? <div role="alert" className="text-sm font-medium text-[#cf222e]">{state.formError}</div> : null}
        <div className="flex justify-end gap-2 border-t border-[#d8dee4] pt-4">
          <WorkbenchButton type="button" variant="ghost" disabled={pending} onClick={() => setDialogOpen(false)}>取消</WorkbenchButton>
          <WorkbenchButton type="submit" variant="primary" disabled={pending || !name.trim()}>
            {pending ? "创建中" : "确认创建公司"}
          </WorkbenchButton>
        </div>
      </form>
    </SettingsDialog>
  );
}
