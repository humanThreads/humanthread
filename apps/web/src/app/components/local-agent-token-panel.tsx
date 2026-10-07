"use client";

import { useState } from "react";
import { requestAgentToken } from "../../lib/agent/agent-token-client";

interface LocalAgentTokenPanelProps {
  userId: string;
}

export function LocalAgentTokenPanel({ userId }: LocalAgentTokenPanelProps) {
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function handleGenerateToken() {
    setIsPending(true);
    setError(null);
    setCopied(false);

    try {
      const result = await requestAgentToken(userId);
      setToken(result.token);
    } catch (requestError) {
      const message =
        requestError instanceof Error ? requestError.message : "Agent token rotation failed";

      setToken(null);
      setError(message);
    } finally {
      setIsPending(false);
      setConfirming(false);
    }
  }

  async function handleCopyToken() {
    if (!token || !navigator?.clipboard) {
      setError("当前环境不支持剪贴板复制，请手动复制 token。");
      return;
    }

    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setError(null);
    } catch {
      setError("复制失败，请手动复制 token。");
    }
  }

  function handleCloseToken() {
    setToken(null);
    setCopied(false);
    setError(null);
  }

  return (
    <div className="mt-5 rounded-md border border-[#d0d7de] bg-white p-4 text-sm text-[#24292f]">
      <p className="leading-6 text-[#57606a]">
        生成后会立即轮换服务端保存的 token 哈希，旧 token 同步失效。明文只在当前面板展示一次，
        关闭后只能重新生成。
      </p>

      <div className="mt-4 flex flex-wrap gap-3">
        {confirming ? (
          <>
            <button
              type="button"
              onClick={handleGenerateToken}
              disabled={isPending}
              className="rounded-md border border-[#1f883d] bg-[#1f883d] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending ? "生成中..." : "确认生成新 Token"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-md border border-[#d0d7de] bg-white px-4 py-2 text-sm font-semibold text-[#24292f]"
            >
              取消
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="rounded-md border border-[#1f883d] bg-[#1f883d] px-4 py-2 text-sm font-semibold text-white"
          >
            生成新 Token
          </button>
        )}
        {token ? (
          <>
            <button
              type="button"
              onClick={handleCopyToken}
              className="rounded-md border border-[#d0d7de] bg-[#f6f8fa] px-4 py-2 text-sm font-semibold text-[#24292f]"
            >
              {copied ? "已复制" : "复制 Token"}
            </button>
            <button
              type="button"
              onClick={handleCloseToken}
              className="rounded-md border border-[#d0d7de] bg-white px-4 py-2 text-sm font-semibold text-[#24292f]"
            >
              关闭明文
            </button>
          </>
        ) : null}
      </div>

      {token ? (
        <div className="mt-4 rounded-md border border-[#d8dee4] bg-[#f6f8fa] p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[#57606a]">
            一次性明文 Token
          </div>
          <div className="mt-3 break-all rounded-md border border-[#d0d7de] bg-white px-4 py-3 font-mono text-xs text-[#24292f]">
            {token}
          </div>
          <p className="mt-3 leading-6 text-[#57606a]">
            请立即复制到桌面端的 API Token 字段。关闭此面板后，不再保留本次明文。
          </p>
        </div>
      ) : null}

      {error ? <div className="mt-4 text-sm text-[#cf222e]">{error}</div> : null}
    </div>
  );
}
