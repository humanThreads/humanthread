"use client";

import { useState, useTransition, type FormEvent } from "react";
import {
  updateWorkbenchCompanyProfileAction,
  type WorkbenchSettingsActionState,
} from "../../workbench/actions";
import { SettingsFormActions } from "../../components/settings-form";

const INITIAL_STATE: WorkbenchSettingsActionState = { ok: false };
const INPUT_CLASS = "rounded-md border border-[#8c959f] bg-white px-3 py-2 text-sm font-normal outline-none focus:border-[#0969da] focus:ring-4 focus:ring-[#0969da]/10";

export function CompanyProfileForm({
  companyId,
  initialDescription,
  initialCertificationLevel,
  action = updateWorkbenchCompanyProfileAction,
}: {
  companyId: string;
  initialDescription: string;
  initialCertificationLevel: string;
  action?: (
    previousState: WorkbenchSettingsActionState,
    formData: FormData,
  ) => Promise<WorkbenchSettingsActionState>;
}) {
  const [savedDescription, setSavedDescription] = useState(initialDescription);
  const [savedCertification, setSavedCertification] = useState(initialCertificationLevel);
  const [description, setDescription] = useState(initialDescription);
  const [certificationLevel, setCertificationLevel] = useState(initialCertificationLevel);
  const [state, setState] = useState(INITIAL_STATE);
  const [pending, startTransition] = useTransition();
  const dirty = description !== savedDescription || certificationLevel !== savedCertification;

  function cancel() {
    setDescription(savedDescription);
    setCertificationLevel(savedCertification);
    setState(INITIAL_STATE);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      const nextState = await action(state, formData);
      setState(nextState);
      if (nextState.ok) {
        setSavedDescription(description);
        setSavedCertification(certificationLevel);
      }
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-4 md:max-w-2xl">
      <input type="hidden" name="companyId" value={companyId} />
      <label className="grid gap-1.5 text-sm font-semibold text-[#24292f]">
        公司简介
        <textarea
          name="description"
          rows={5}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="介绍公司定位、团队协作方式或空间用途"
          className={INPUT_CLASS}
        />
      </label>
      <label className="grid gap-1.5 text-sm font-semibold text-[#24292f] md:max-w-sm">
        认证等级
        <select name="certificationLevel" value={certificationLevel} onChange={(event) => setCertificationLevel(event.target.value)} className={INPUT_CLASS}>
          <option value="none">未认证</option>
          <option value="normal">普通认证</option>
          <option value="vip">会员认证</option>
          <option value="community">社区认证</option>
        </select>
      </label>
      <SettingsFormActions
        dirty={dirty}
        pending={pending}
        onCancel={cancel}
        saveLabel="保存公司资料"
        {...(state.ok ? { successMessage: "公司资料已保存" } : {})}
        {...(state.formError ? { errorMessage: state.formError } : {})}
      />
    </form>
  );
}
