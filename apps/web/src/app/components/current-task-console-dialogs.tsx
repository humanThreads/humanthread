"use client";

import { useState, type ReactNode } from "react";
import { getTaskPrimaryAction } from "../../lib/workbench/workbench-task-analytics";
import {
  openWorkbenchLocalAction,
  submitWorkbenchTaskAction,
} from "../workbench/actions";
import { WorkbenchButton } from "./workbench-ui";

type CurrentTaskActionType =
  | "start"
  | "open-local"
  | "complete"
  | "block"
  | "interrupt"
  | "follow_up"
  | "transfer";

type CurrentTaskActionDialogProps = {
  taskId: string;
  projectPath: string | null;
  command: string | null;
  missingContextKeys?: Array<"documents" | "local_path" | "default_command" | "mcp_credentials">;
  taskStatus?: "pending" | "active" | "blocked" | "interrupted" | "follow_up" | "completed";
};

function CurrentTaskActionDialog({
  open,
  title,
  description,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  description: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="关闭弹窗"
        onClick={onClose}
        className="absolute inset-0 bg-[#1f2328]/50"
      />
      <div className="relative mx-auto mt-24 w-[min(92vw,560px)] rounded-2xl border border-[#d0d7de] bg-white shadow-[0_24px_60px_rgba(31,35,40,0.24)]">
        <div className="flex items-start justify-between gap-4 border-b border-[#d8dee4] px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-[#24292f]">{title}</h3>
            <p className="mt-1 text-sm leading-6 text-[#57606a]">{description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full text-[#57606a] transition hover:bg-[#f6f8fa] hover:text-[#24292f]"
            aria-label="关闭"
          >
            ×
          </button>
        </div>
        <div className="px-5 py-5">{children}</div>
      </div>
    </div>
  );
}

function ReasonDialogForm({
  taskId,
  actionType,
  title,
  description,
  buttonLabel,
  buttonVariant,
  onClose,
}: {
  taskId: string;
  actionType: "block" | "interrupt" | "follow_up" | "complete";
  title: string;
  description: string;
  buttonLabel: string;
  buttonVariant: "primary" | "secondary" | "danger";
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");

  return (
    <CurrentTaskActionDialog open title={title} description={description} onClose={onClose}>
      <form action={submitWorkbenchTaskAction} className="grid gap-4">
        <input type="hidden" name="taskId" value={taskId} />
        <input type="hidden" name="actionType" value={actionType} />
        {actionType !== "complete" ? (
          <label className="grid gap-1 text-sm font-semibold text-[#24292f]">
            原因 / 说明
            <input
              name="reason"
              type="text"
              required
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={actionType === "follow_up" ? "输入跟进说明" : "输入原因"}
              className="rounded-md border border-[#d0d7de] bg-white px-3 py-2 text-sm font-normal outline-none focus:border-[#0969da]"
            />
          </label>
        ) : (
          <div className="rounded-md border border-[#d0d7de] bg-[#f6f8fa] px-3 py-2 text-sm text-[#57606a]">
            确认后会把当前任务标记为完成。
          </div>
        )}
        <div className="flex justify-end gap-2">
          <WorkbenchButton type="button" variant="ghost" onClick={onClose}>
            取消
          </WorkbenchButton>
          <WorkbenchButton type="submit" variant={buttonVariant} onClick={onClose}>
            {buttonLabel}
          </WorkbenchButton>
        </div>
      </form>
    </CurrentTaskActionDialog>
  );
}

function TransferDialogForm({
  taskId,
  title,
  description,
  buttonLabel,
  onClose,
}: {
  taskId: string;
  title: string;
  description: string;
  buttonLabel: string;
  onClose: () => void;
}) {
  const [targetUserId, setTargetUserId] = useState("");
  const [reason, setReason] = useState("");

  return (
    <CurrentTaskActionDialog open title={title} description={description} onClose={onClose}>
      <form action={submitWorkbenchTaskAction} className="grid gap-4">
        <input type="hidden" name="taskId" value={taskId} />
        <input type="hidden" name="actionType" value="transfer" />
        <label className="grid gap-1 text-sm font-semibold text-[#24292f]">
          转交对象 ID
          <input
            name="targetUserId"
            type="text"
            required
            value={targetUserId}
            onChange={(event) => setTargetUserId(event.target.value)}
            placeholder="输入转交对象 ID"
            className="rounded-md border border-[#d0d7de] bg-white px-3 py-2 text-sm font-normal outline-none focus:border-[#0969da]"
          />
        </label>
        <label className="grid gap-1 text-sm font-semibold text-[#24292f]">
          原因 / 说明
          <input
            name="reason"
            type="text"
            required
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="输入转交原因"
            className="rounded-md border border-[#d0d7de] bg-white px-3 py-2 text-sm font-normal outline-none focus:border-[#0969da]"
          />
        </label>
        <div className="flex justify-end gap-2">
          <WorkbenchButton type="button" variant="ghost" onClick={onClose}>
            取消
          </WorkbenchButton>
          <WorkbenchButton type="submit" variant="secondary" onClick={onClose}>
            {buttonLabel}
          </WorkbenchButton>
        </div>
      </form>
    </CurrentTaskActionDialog>
  );
}

export function CurrentTaskActionDialogs({
  taskId,
  projectPath,
  command,
  missingContextKeys = [],
  taskStatus = "pending",
}: CurrentTaskActionDialogProps) {
  const [openAction, setOpenAction] = useState<CurrentTaskActionType | null>(null);
  const primaryAction = getTaskPrimaryAction({
    task: {
      id: taskId,
      status: taskStatus,
      title: "",
      queuePosition: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    project: {
      id: "project",
      name: "",
      spaceLabel: "",
      description: null,
      localPath: projectPath,
      defaultCommand: command,
    },
    contextMissingKeys: missingContextKeys,
  });

  function closeDialog() {
    setOpenAction(null);
  }

  return (
    <>
      <div className="flex flex-wrap justify-end gap-2">
        {primaryAction.action === "start" ? (
          <WorkbenchButton type="button" onClick={() => setOpenAction("start")}>
            {primaryAction.label}
          </WorkbenchButton>
        ) : (
          <WorkbenchButton type="button" onClick={() => setOpenAction("open-local")}>
            {primaryAction.label}
          </WorkbenchButton>
        )}
        <WorkbenchButton type="button" onClick={() => setOpenAction("open-local")}>打开本地</WorkbenchButton>
        <WorkbenchButton type="button" variant="primary" onClick={() => setOpenAction("complete")}>完成</WorkbenchButton>
        <WorkbenchButton type="button" variant="danger" onClick={() => setOpenAction("block")}>标记阻塞</WorkbenchButton>
        <WorkbenchButton type="button" variant="danger" onClick={() => setOpenAction("interrupt")}>中断</WorkbenchButton>
        <WorkbenchButton type="button" variant="secondary" onClick={() => setOpenAction("follow_up")}>跟进</WorkbenchButton>
        <WorkbenchButton type="button" variant="secondary" onClick={() => setOpenAction("transfer")}>转交</WorkbenchButton>
      </div>

      <CurrentTaskActionDialog
        open={openAction === "start"}
        title="开始任务"
        description={
          primaryAction.action === "start"
            ? "确认后会将当前任务标记为开始。"
            : "当前任务还缺关键前置，请先补齐上下文或配置执行环境。"
        }
        onClose={closeDialog}
      >
        <form action={submitWorkbenchTaskAction} className="grid gap-4">
          <input type="hidden" name="taskId" value={taskId} />
          <input type="hidden" name="actionType" value="start" />
          <div className="rounded-md border border-[#d0d7de] bg-[#f6f8fa] px-3 py-2 text-sm text-[#57606a]">
            当前任务开始后，将进入执行状态。
          </div>
          <div className="flex justify-end gap-2">
            <WorkbenchButton type="button" variant="ghost" onClick={closeDialog}>取消</WorkbenchButton>
            <WorkbenchButton
              type="submit"
              variant="primary"
              onClick={closeDialog}
              disabled={primaryAction.action !== "start"}
            >
              {primaryAction.action === "start" ? "开始" : primaryAction.label}
            </WorkbenchButton>
          </div>
        </form>
      </CurrentTaskActionDialog>

      <CurrentTaskActionDialog
        open={openAction === "open-local"}
        title="打开本地"
        description="会把当前任务对应的本地目录和默认命令发送给本地 Agent。"
        onClose={closeDialog}
      >
        <form action={openWorkbenchLocalAction} className="grid gap-4">
          <input type="hidden" name="taskId" value={taskId} />
          <input type="hidden" name="projectPath" value={projectPath ?? ""} />
          <input type="hidden" name="command" value={command ?? ""} />
          <div className="rounded-md border border-[#d0d7de] bg-[#f6f8fa] px-3 py-2 text-sm text-[#57606a]">
            {projectPath ? `目录：${projectPath}` : "目录未配置"}
            <br />
            {command ? `命令：${command}` : "命令未配置"}
          </div>
          <div className="flex justify-end gap-2">
            <WorkbenchButton type="button" variant="ghost" onClick={closeDialog}>取消</WorkbenchButton>
            <WorkbenchButton type="submit" onClick={closeDialog}>打开本地</WorkbenchButton>
          </div>
        </form>
      </CurrentTaskActionDialog>

      {openAction === "complete" ? (
        <ReasonDialogForm
          taskId={taskId}
          actionType="complete"
          title="完成任务"
          description="确认后会把当前任务标记为完成。"
          buttonLabel="完成"
          buttonVariant="primary"
          onClose={closeDialog}
        />
      ) : null}

      {openAction === "block" ? (
        <ReasonDialogForm
          taskId={taskId}
          actionType="block"
          title="标记阻塞"
          description="填写阻塞原因后提交。"
          buttonLabel="标记阻塞"
          buttonVariant="danger"
          onClose={closeDialog}
        />
      ) : null}

      {openAction === "interrupt" ? (
        <ReasonDialogForm
          taskId={taskId}
          actionType="interrupt"
          title="中断任务"
          description="填写中断原因后提交。"
          buttonLabel="中断"
          buttonVariant="danger"
          onClose={closeDialog}
        />
      ) : null}

      {openAction === "follow_up" ? (
        <ReasonDialogForm
          taskId={taskId}
          actionType="follow_up"
          title="任务跟进"
          description="填写跟进说明后提交。"
          buttonLabel="跟进"
          buttonVariant="secondary"
          onClose={closeDialog}
        />
      ) : null}

      {openAction === "transfer" ? (
        <TransferDialogForm
          taskId={taskId}
          title="转交任务"
          description="输入转交对象 ID 和原因后提交。"
          buttonLabel="转交"
          onClose={closeDialog}
        />
      ) : null}
    </>
  );
}
