"use client";

import { useState } from "react";
import { requestAgentBindingCode } from "../../lib/agent/agent-binding-code-client";

interface LocalAgentBindingCodePanelProps {
  userId: string;
}

export function LocalAgentBindingCodePanel({
  userId,
}: LocalAgentBindingCodePanelProps) {
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function handleGenerateCode() {
    setIsPending(true);
    setCopied(false);
    setError(null);

    try {
      const result = await requestAgentBindingCode(userId);
      setCode(result.code);
      setExpiresAt(result.expiresAt);
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : "Agent binding code failed";

      setCode(null);
      setExpiresAt(null);
      setError(message);
    } finally {
      setIsPending(false);
      setConfirming(false);
    }
  }

  async function handleCopyCode() {
    if (!code || !navigator?.clipboard) {
      setError("当前环境不支持剪贴板复制，请手动复制绑定码。");
      return;
    }

    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setError(null);
    } catch {
      setError("复制失败，请手动复制绑定码。");
    }
  }

  return (
    <div className="rounded-md border border-[#d0d7de] bg-[#f6f8fa] p-3 text-sm text-[#24292f]">
      <div className="font-semibold">登录式设备绑定码</div>
      <p className="mt-2 text-xs leading-5 text-[#57606a]">
        绑定码有效期 10 分钟。客户端填写绑定码后会自动完成设备授权；
        仅填写邮箱仍会进入待授权列表。
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {confirming ? (
          <>
            <button
              type="button"
              onClick={handleGenerateCode}
              disabled={isPending}
              className="rounded-md border border-[#1f883d] bg-[#1f883d] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
            >
              {isPending ? "生成中..." : "确认生成绑定码"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-md border border-[#d0d7de] bg-white px-3 py-1.5 text-xs font-semibold text-[#24292f]"
            >
              取消
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="rounded-md border border-[#1f883d] bg-[#1f883d] px-3 py-1.5 text-xs font-semibold text-white"
          >
            生成绑定码
          </button>
        )}
        {code ? (
          <button
            type="button"
            onClick={handleCopyCode}
            className="rounded-md border border-[#d0d7de] bg-white px-3 py-1.5 text-xs font-semibold text-[#24292f]"
          >
            {copied ? "已复制" : "复制绑定码"}
          </button>
        ) : null}
      </div>
      {code ? (
        <div className="mt-3 rounded-md border border-[#d8dee4] bg-white p-3">
          <div className="break-all font-mono text-xs text-[#24292f]">{code}</div>
          <div className="mt-2 text-xs text-[#57606a]">
            过期时间：{expiresAt ?? "未记录"}
          </div>
        </div>
      ) : null}
      {error ? <div className="mt-3 text-xs text-[#cf222e]">{error}</div> : null}
    </div>
  );
}
