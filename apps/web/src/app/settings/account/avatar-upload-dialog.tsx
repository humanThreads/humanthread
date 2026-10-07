"use client";

import { useId, useState } from "react";
import { WorkbenchButton } from "../../components/workbench-ui";

export function AccountAvatarUploadDialog({
  action = "/api/workbench/avatar",
  accept,
  maxBytes,
}: {
  action?: string;
  accept: string;
  maxBytes: number;
}) {
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const inputId = useId();

  function closeDialog() {
    setOpen(false);
    setFileName(null);
  }

  return (
    <div className="rounded-xl border border-[#d0d7de] bg-[#f6f8fa] p-4">
      <div className="flex flex-wrap items-center gap-3">
        <WorkbenchButton type="button" variant="primary" onClick={() => setOpen(true)}>
          上传头像
        </WorkbenchButton>
        <span className="text-xs text-[#57606a]">点击打开上传弹窗</span>
      </div>

      <p className="mt-3 text-xs leading-5 text-[#57606a]">
        上传完成后会立即更新工作台头像，支持 PNG / JPG / WEBP / GIF，文件大小不超过{" "}
        {Math.round(maxBytes / 1024 / 1024)} MB。
      </p>

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        hidden={!open}
        className="fixed inset-0 z-50"
      >
        <button
          type="button"
          aria-label="关闭上传弹窗"
          onClick={closeDialog}
          className="absolute inset-0 cursor-default bg-[#1f2328]/60"
        />
        <div className="relative mx-auto mt-24 w-[min(92vw,560px)] rounded-2xl border border-[#d0d7de] bg-white shadow-[0_24px_60px_rgba(31,35,40,0.24)]">
          <div className="flex items-start justify-between gap-4 border-b border-[#d8dee4] px-5 py-4">
            <div>
              <h3 id={titleId} className="text-base font-semibold text-[#24292f]">
                上传头像
              </h3>
              <p id={descriptionId} className="mt-1 text-sm leading-6 text-[#57606a]">
                选择图片后提交，系统会保存到本地静态目录并立即刷新头像。
              </p>
            </div>
            <button
              type="button"
              onClick={closeDialog}
              className="grid h-8 w-8 place-items-center rounded-full text-[#57606a] transition hover:bg-[#f6f8fa] hover:text-[#24292f]"
              aria-label="关闭"
            >
              ×
            </button>
          </div>

          <form
            action={action}
            method="post"
            encType="multipart/form-data"
            className="grid gap-4 px-5 py-5"
          >
            <input
              id={inputId}
              type="file"
              name="avatar"
              accept={accept}
              className="sr-only"
              onChange={(event) => {
                setFileName(event.currentTarget.files?.[0]?.name ?? null);
              }}
            />
            <label
              htmlFor={inputId}
              className="grid cursor-pointer gap-3 rounded-2xl border border-dashed border-[#d0d7de] bg-[#f6f8fa] px-5 py-6 transition hover:border-[#0969da] hover:bg-[#f0f7ff]"
            >
              <span className="text-sm font-semibold text-[#24292f]">
                {fileName ? "已选择文件" : "选择头像文件"}
              </span>
              <span className="text-xs leading-5 text-[#57606a]">
                {fileName
                  ? fileName
                  : "点击选择本地图片文件，上传后会同步到侧边栏和工作台页面。"}
              </span>
            </label>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <WorkbenchButton type="button" variant="ghost" onClick={closeDialog}>
                取消
              </WorkbenchButton>
              <WorkbenchButton type="submit" variant="primary">
                开始上传
              </WorkbenchButton>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
