"use client";

import { useState } from "react";

export function RegistrationVerificationButton() {
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );

  async function sendVerificationCode() {
    const emailInput = document.querySelector<HTMLInputElement>(
      'input[name="email"]',
    );
    const email = emailInput?.value.trim() ?? "";

    if (!email) {
      emailInput?.reportValidity();
      return;
    }

    setStatus("sending");

    const response = await fetch("/api/workbench/register", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        intent: "send-verification",
        email,
      }),
    });

    setStatus(response.ok ? "sent" : "error");
  }

  return (
    <button
      type="button"
      data-register-verification-trigger
      onClick={sendVerificationCode}
      disabled={status === "sending"}
      className="rounded-xl border border-[#d0d7de] bg-[#f6f8fa] px-4 py-3 text-sm font-semibold text-[#24292f] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
    >
      {status === "sending" ? "发送中..." : status === "sent" ? "已发送" : "发送验证码"}
    </button>
  );
}
