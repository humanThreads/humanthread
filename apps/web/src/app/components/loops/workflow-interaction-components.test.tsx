// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkflowApprovalControls } from "./workflow-approval-controls";
import { WorkflowInteractionComposer } from "./workflow-interaction-composer";
import { WorkflowInteractionThread } from "./workflow-interaction-thread";

const openInteraction = { id: "interaction_1", kind: "requirement_conversation", status: "open", version: 1, messages: [], decision: null };

afterEach(cleanup);

describe("workflow interaction workspace controls", () => {
  it("submits free text and structured answers", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<WorkflowInteractionComposer interaction={openInteraction} fields={[{ key: "confirmed", label: "需求是否确认", control: "single_select", options: [{ value: "yes", label: "确定" }, { value: "no", label: "否" }], required: true }]} onSubmit={onSubmit} enabled />);
    fireEvent.change(screen.getByLabelText("需求是否确认"), { target: { value: "yes" } });
    fireEvent.change(screen.getByLabelText("输入回复"), { target: { value: "已核对" } });
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ body: "已核对", answers: { confirmed: ["yes"] } })));
  });

  it("hides mutation controls and keeps immutable history after a decision", () => {
    render(<><WorkflowInteractionThread interaction={{ ...openInteraction, status: "approved", messages: [{ id: "m1", actorType: "agent", actorId: "a1", body: "请审批", answers: {}, createdAt: "2026-08-05T10:00:00.000Z" }], decision: { decision: "approved", reason: null } }} /><WorkflowApprovalControls interaction={{ ...openInteraction, status: "approved" }} canConfirm canDecideApproval /></>);
    expect(screen.getAllByText("用户已批准").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "同意" })).toBeNull();
  });

  it("shows each speaker's confirmation state and lets the current speaker confirm", async () => {
    const onConfirmPosition = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      ...openInteraction,
      kind: "runtime_intervention",
      discussionState: {
        phase: "ordinary",
        activeSpeakerKey: null,
        speakers: [
          { speakerKey: "a".repeat(32), actorUserId: "user_a", displayName: "Alice", latestSequence: 3, confirmed: false },
          { speakerKey: "b".repeat(32), actorUserId: "user_b", displayName: "Bob", latestSequence: 4, confirmed: true },
        ],
        conflicts: [],
        missingConfirmationCount: 1,
        missingSpeakerKeys: ["a".repeat(32)],
        allSpeakersConfirmed: false,
        hasConflict: false,
      },
      capabilities: {
        canReply: true,
        canConfirmOwnPosition: true,
        canSubmit: false,
        canDelegateConflictSpeaker: false,
        canResolveConflict: false,
      },
    };

    render(<>
      <WorkflowInteractionThread interaction={interaction} />
      <WorkflowApprovalControls interaction={interaction} onConfirmPosition={onConfirmPosition} />
    </>);

    expect(screen.getByText("Alice")).toBeTruthy();
    expect(screen.getByText("Bob")).toBeTruthy();
    expect(screen.getByText("等待 Alice 确认")).toBeTruthy();
    const button = screen.getByRole("button", { name: "确认我的意见" });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    await vi.waitFor(() => expect(onConfirmPosition).toHaveBeenCalledOnce());
  });

  it("explains why the assignee cannot submit while another speaker is unconfirmed", () => {
    const interaction = {
      ...openInteraction,
      kind: "runtime_intervention",
      discussionState: {
        phase: "ordinary",
        activeSpeakerKey: null,
        speakers: [{ speakerKey: "a".repeat(32), actorUserId: "user_a", displayName: "Alice", latestSequence: 3, confirmed: false }],
        conflicts: [],
        missingConfirmationCount: 1,
        missingSpeakerKeys: ["a".repeat(32)],
        allSpeakersConfirmed: false,
        hasConflict: false,
      },
      capabilities: { canReply: true, canConfirmOwnPosition: false, canSubmit: false, canDelegateConflictSpeaker: false, canResolveConflict: false },
    };

    render(<WorkflowApprovalControls interaction={interaction} />);

    expect(screen.getByText("等待所有发言人确认后，任务负责人才能提交")).toBeTruthy();
    expect((screen.getByRole("button", { name: "确认提交" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("supports project-owner delegation and active conflict-speaker direct submission", async () => {
    const onDelegate = vi.fn().mockResolvedValue(undefined);
    const onSubmitIntervention = vi.fn().mockResolvedValue(undefined);
    const base = {
      ...openInteraction,
      kind: "runtime_intervention",
      discussionState: {
        phase: "conflict_resolution",
        activeSpeakerKey: "a".repeat(32),
        speakers: [{ speakerKey: "a".repeat(32), actorUserId: "user_a", displayName: "Alice", latestSequence: 6, confirmed: false }],
        conflicts: [{ topicKey: "source", optionKeys: ["existing", "new"] }],
        missingConfirmationCount: 1,
        missingSpeakerKeys: ["a".repeat(32)],
        allSpeakersConfirmed: false,
        hasConflict: true,
      },
    };

    render(<WorkflowApprovalControls interaction={{
      ...base,
      capabilities: {
        canReply: true,
        canConfirmOwnPosition: false,
        canSubmit: false,
        canDelegateConflictSpeaker: true,
        canResolveConflict: false,
        conflictSpeakerCandidates: [{ userId: "user_b", displayName: "Bob" }],
      },
    }} onDelegateConflictSpeaker={onDelegate} />);
    fireEvent.change(screen.getByLabelText("转交二次发言人"), { target: { value: "user_b" } });
    fireEvent.click(screen.getByRole("button", { name: "转交发言权" }));
    await vi.waitFor(() => expect(onDelegate).toHaveBeenCalledWith("user_b"));

    cleanup();
    render(<WorkflowApprovalControls interaction={{
      ...base,
      capabilities: { canReply: true, canConfirmOwnPosition: false, canSubmit: false, canDelegateConflictSpeaker: false, canResolveConflict: true },
    }} onSubmitIntervention={onSubmitIntervention} />);
    fireEvent.change(screen.getByLabelText("恢复动作"), { target: { value: "terminate" } });
    fireEvent.click(screen.getByRole("button", { name: "确认提交" }));
    await vi.waitFor(() => expect(onSubmitIntervention).toHaveBeenCalledWith("terminate", "", false));
  });
});
