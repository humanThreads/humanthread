"use client";

import type { WorkflowInteractionField, WorkflowInteractionMessageInput, WorkflowInteractionView } from "@humanthread/shared";
import { Send } from "lucide-react";
import { useState } from "react";

export function WorkflowInteractionComposer({
  interaction,
  fields = [],
  enabled = true,
  onSubmit,
}: {
  interaction: WorkflowInteractionView | Record<string, unknown>;
  fields?: WorkflowInteractionField[];
  enabled?: boolean;
  onSubmit: (message: WorkflowInteractionMessageInput) => Promise<void> | void;
}) {
  const [body, setBody] = useState("");
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [sending, setSending] = useState(false);
  const terminal = interaction.status !== "open";
  const requiredFieldsComplete = fields.every((field) => !field.required || (answers[field.key]?.length ?? 0) > 0);
  const canSend = enabled && !terminal && requiredFieldsComplete && (body.trim().length > 0 || Object.values(answers).some((value) => value.length > 0));
  async function submit() {
    if (!canSend || sending) return;
    setSending(true);
    try {
      await onSubmit({ body, answers, attachmentIds: [], mentionedUserIds: [] });
      setBody("");
      setAnswers({});
    } finally { setSending(false); }
  }
  if (terminal) return null;
  return (
    <section aria-label="需求沟通输入" className="border-t border-[#d0d7de] bg-white px-4 py-3">
      {fields.length > 0 ? <div className="grid gap-3 sm:grid-cols-2">{fields.map((field) => <InteractionField key={field.key} field={field} value={answers[field.key] ?? []} onChange={(value) => setAnswers((current) => ({ ...current, [field.key]: value }))} disabled={terminal || !enabled} />)}</div> : null}
      <textarea aria-label="输入回复" value={body} onChange={(event) => setBody(event.currentTarget.value)} disabled={terminal || !enabled} placeholder={terminal ? "交互已结束" : "输入回复"} className="mt-3 min-h-20 w-full resize-y rounded-md border border-[#d0d7de] px-3 py-2 text-sm text-[#24292f] outline-none focus:border-[#0969da] disabled:bg-[#f6f8fa]" />
      <div className="mt-2 flex justify-end"><button type="button" onClick={() => void submit()} disabled={!canSend || sending} className="inline-flex items-center gap-2 rounded-md bg-[#1f883d] px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"><Send aria-hidden="true" className="h-4 w-4" />{sending ? "发送中" : "发送消息"}</button></div>
    </section>
  );
}

function InteractionField({ field, value, onChange, disabled }: { field: WorkflowInteractionField; value: string[]; onChange: (value: string[]) => void; disabled: boolean }) {
  if (field.control === "text") return <label className="text-xs font-medium text-[#57606a]">{field.label}<input value={value[0] ?? ""} required={field.required} disabled={disabled} onChange={(event) => onChange(event.currentTarget.value ? [event.currentTarget.value] : [])} className="mt-1 w-full rounded-md border border-[#d0d7de] px-2 py-2 text-sm font-normal text-[#24292f]" /></label>;
  if (field.control === "single_select") return <label className="text-xs font-medium text-[#57606a]">{field.label}<select value={value[0] ?? ""} required={field.required} disabled={disabled} onChange={(event) => onChange(event.currentTarget.value ? [event.currentTarget.value] : [])} className="mt-1 w-full rounded-md border border-[#d0d7de] bg-white px-2 py-2 text-sm font-normal text-[#24292f]"><option value="">请选择</option>{field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
  return <fieldset disabled={disabled} className="text-xs font-medium text-[#57606a]"><legend>{field.label}</legend><div className="mt-1 flex flex-wrap gap-2">{field.options.map((option) => <label key={option.value} className="inline-flex items-center gap-1 font-normal text-[#24292f]"><input type="checkbox" checked={value.includes(option.value)} onChange={(event) => onChange(event.currentTarget.checked ? [...value, option.value] : value.filter((item) => item !== option.value))} />{option.label}</label>)}</div></fieldset>;
}
