import { describe, expect, it } from "vitest";
import type { WorkflowInteractionView } from "@humanthread/shared";

import { deriveInteractionCapabilities } from "./workflow-interaction-query";
import { workflowSpeakerKey } from "../../../../../packages/db/src/workflow-interaction-discussion";

const userASpeakerKey = workflowSpeakerKey("user_a");

const baseInteraction = {
  id: "interaction_1",
  kind: "runtime_intervention",
  status: "open",
  discussionState: {
    phase: "ordinary",
    activeSpeakerKey: null,
    speakers: [{ speakerKey: userASpeakerKey, actorUserId: "user_a", displayName: "Alice", latestSequence: 2, confirmed: false }],
    conflicts: [],
    missingConfirmationCount: 1,
    missingSpeakerKeys: [userASpeakerKey],
    allSpeakersConfirmed: false,
    hasConflict: false,
  },
} as unknown as WorkflowInteractionView;

describe("workflow interaction capability projection", () => {
  it("only gives the speaker self-confirmation and keeps the assignee submit blocked", () => {
    expect(deriveInteractionCapabilities({
      interaction: baseInteraction,
      userId: "user_a",
      projectRole: "contributor",
      projectManagerUserId: "project_owner",
      taskAssigneeUserId: "user_assignee",
      taskParticipantCandidates: [{ userId: "user_a", displayName: "Alice" }],
    })).toMatchObject({
      canReply: true,
      canConfirmOwnPosition: true,
      canSubmit: false,
      canDelegateConflictSpeaker: false,
      canResolveConflict: false,
    });
  });

  it("gives the assignee submit only after all speakers confirm", () => {
    expect(deriveInteractionCapabilities({
      interaction: {
        ...baseInteraction,
        discussionState: { ...baseInteraction.discussionState, speakers: [], missingConfirmationCount: 0, allSpeakersConfirmed: true },
      } as unknown as WorkflowInteractionView,
      userId: "user_assignee",
      projectRole: "contributor",
      projectManagerUserId: "project_owner",
      taskAssigneeUserId: "user_assignee",
      taskParticipantCandidates: [],
    })).toMatchObject({ canSubmit: true, canConfirmOwnPosition: false });
  });

  it("separates project-owner delegation from active-speaker resolution in conflict phase", () => {
    const conflict = {
      ...baseInteraction,
      discussionState: {
        ...baseInteraction.discussionState,
        phase: "conflict_resolution",
        activeSpeakerKey: userASpeakerKey,
        missingConfirmationCount: 1,
      },
    } as unknown as WorkflowInteractionView;
    expect(deriveInteractionCapabilities({
      interaction: conflict,
      userId: "project_owner",
      projectRole: "maintainer",
      projectManagerUserId: "project_owner",
      taskAssigneeUserId: "user_assignee",
      taskParticipantCandidates: [
        { userId: "user_a", displayName: "Alice" },
        { userId: "user_b", displayName: "Bob" },
      ],
    })).toMatchObject({ canDelegateConflictSpeaker: true, canResolveConflict: false, canSubmit: false });
    expect(deriveInteractionCapabilities({
      interaction: conflict,
      userId: "user_a",
      projectRole: "contributor",
      projectManagerUserId: "project_owner",
      taskAssigneeUserId: "user_assignee",
      taskParticipantCandidates: [
        { userId: "user_a", displayName: "Alice" },
        { userId: "user_b", displayName: "Bob" },
      ],
    })).toMatchObject({ canResolveConflict: true, canSubmit: true, canDelegateConflictSpeaker: false });
  });
});
