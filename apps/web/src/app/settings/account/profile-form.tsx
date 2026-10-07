"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  updateWorkbenchAccountProfileAction,
  type WorkbenchSettingsActionState,
} from "../../workbench/actions";
import { SettingsFormActions } from "../../components/settings-form";

const INITIAL_STATE: WorkbenchSettingsActionState = { ok: false };

export function AccountProfileForm({
  initialName,
  action = updateWorkbenchAccountProfileAction,
}: {
  initialName: string;
  action?: (
    previousState: WorkbenchSettingsActionState,
    formData: FormData,
  ) => Promise<WorkbenchSettingsActionState>;
}) {
  const [savedName, setSavedName] = useState(initialName);
  const [name, setName] = useState(initialName);
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE);
  const submittedName = useRef(initialName);
  const dirty = name.trim() !== savedName.trim();

  useEffect(() => {
    if (state.ok) {
      setSavedName(submittedName.current);
    }
  }, [state]);

  function submit(formData: FormData) {
    submittedName.current = name.trim();
    formAction(formData);
  }

  return (
    <form action={submit} className="grid gap-2 md:max-w-xl">
      <label className="grid gap-1.5 text-sm font-semibold text-[#24292f]">
        姓名
        <input
          name="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-invalid={Boolean(state.fieldErrors?.name)}
          className="h-10 rounded-md border border-[#8c959f] bg-white px-3 text-sm font-normal outline-none focus:border-[#0969da] focus:ring-4 focus:ring-[#0969da]/10"
        />
      </label>
      {state.fieldErrors?.name ? (
        <div role="alert" className="text-xs font-medium text-[#cf222e]">{state.fieldErrors.name}</div>
      ) : null}
      <SettingsFormActions
        dirty={dirty}
        pending={pending}
        onCancel={() => setName(savedName)}
        {...(state.ok ? { successMessage: "个人资料已保存" } : {})}
        {...(state.formError ? { errorMessage: state.formError } : {})}
      />
    </form>
  );
}
