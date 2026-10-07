import { describe, expect, it } from "vitest";

import {
  interventionResolutionActionSchema,
  workflowInteractionCommandSchema,
  workflowInteractionDiscussionStateSchema,
  workflowInteractionMessageInputSchema,
  workflowInteractionPolicySchema,
  workflowInteractionSpeakerDelegationSchema,
  workflowInteractionViewSchema,
} from "./workflow-interactions";

describe("workflow interaction contracts", () => {
  it("accepts structured choices together with free text", () => {
    expect(workflowInteractionMessageInputSchema.parse({
      body: "Start with one Project.",
      answers: { rollout: ["single_project"] },
      attachmentIds: [],
      mentionedUserIds: ["user_owner"],
    })).toEqual({
      body: "Start with one Project.",
      answers: { rollout: ["single_project"] },
      attachmentIds: [],
      mentionedUserIds: ["user_owner"],
    });
  });

  it("requires at least one message content channel", () => {
    expect(workflowInteractionMessageInputSchema.safeParse({
      body: "",
      answers: {},
      attachmentIds: [],
      mentionedUserIds: [],
    }).success).toBe(false);
  });

  it("accepts position and speaker-confirmation discussion metadata", () => {
    expect(workflowInteractionMessageInputSchema.parse({
      body: "Use the existing mobile contract.",
      answers: {},
      attachmentIds: [],
      mentionedUserIds: [],
      discussion: {
        event: "position",
        conclusion: { topicKey: "source", optionKey: "existing", exclusive: true },
      },
    }).discussion).toMatchObject({ event: "position" });
    expect(workflowInteractionMessageInputSchema.parse({
      body: "I confirm my latest position.",
      answers: {},
      attachmentIds: [],
      mentionedUserIds: [],
      discussion: {
        event: "speaker_confirmation",
        positionSequence: 4,
        positionDigest: "a".repeat(64),
      },
    }).discussion).toMatchObject({ positionSequence: 4 });
    expect(workflowInteractionMessageInputSchema.parse({
      body: "",
      answers: {},
      attachmentIds: [],
      mentionedUserIds: [],
      discussion: {
        event: "speaker_confirmation",
        positionSequence: 4,
        positionDigest: "a".repeat(64),
      },
    }).discussion).toMatchObject({ event: "speaker_confirmation" });
  });

  it("accepts bounded resolution actions and explicit conflict-speaker delegation", () => {
    expect(interventionResolutionActionSchema.parse({ type: "route_upstream", targetNodeKey: "scope" })).toEqual({
      type: "route_upstream", targetNodeKey: "scope",
    });
    expect(interventionResolutionActionSchema.parse({ type: "resume_checkpoint" })).toEqual({ type: "resume_checkpoint" });
    expect(interventionResolutionActionSchema.parse({ type: "terminate" })).toEqual({ type: "terminate" });
    expect(workflowInteractionMessageInputSchema.parse({
      body: "",
      answers: {},
      attachmentIds: [],
      mentionedUserIds: [],
      discussion: { event: "speaker_delegation", speakerKey: "b".repeat(32) },
    }).discussion).toEqual({ event: "speaker_delegation", speakerKey: "b".repeat(32) });
    expect(workflowInteractionSpeakerDelegationSchema.parse({
      event: "speaker_delegation",
      speakerKey: "c".repeat(32),
    })).toEqual({ event: "speaker_delegation", speakerKey: "c".repeat(32) });
    expect(workflowInteractionDiscussionStateSchema.parse({
      phase: "conflict_resolution",
      activeSpeakerKey: "b".repeat(32),
      speakers: [{ speakerKey: "a".repeat(32), latestSequence: 2, confirmed: false }],
      conflicts: [{ topicKey: "source", optionKeys: ["a", "b"] }],
    })).toMatchObject({ phase: "conflict_resolution" });
  });

  it("rejects malformed discussion metadata", () => {
    expect(workflowInteractionMessageInputSchema.safeParse({
      body: "Bad confirmation",
      answers: {},
      attachmentIds: [],
      mentionedUserIds: [],
      discussion: { event: "speaker_confirmation", positionSequence: 0, positionDigest: "bad" },
    }).success).toBe(false);
    expect(workflowInteractionDiscussionStateSchema.safeParse({
      phase: "conflict_resolution",
      activeSpeakerKey: "USER_1",
      speakers: [],
      conflicts: [],
    }).success).toBe(false);
    expect(workflowInteractionMessageInputSchema.safeParse({
      body: "",
      answers: {},
      attachmentIds: [],
      mentionedUserIds: [],
      discussion: { event: "speaker_delegation", speakerKey: "A".repeat(32) },
    }).success).toBe(false);
    expect(workflowInteractionMessageInputSchema.safeParse({
      body: "",
      answers: {},
      attachmentIds: [],
      mentionedUserIds: [],
      discussion: { event: "speaker_delegation", speakerKey: "a".repeat(31) },
    }).success).toBe(false);
    expect(workflowInteractionDiscussionStateSchema.safeParse({
      phase: "ordinary",
      activeSpeakerKey: "a".repeat(32),
      speakers: [],
      conflicts: [],
    }).success).toBe(false);
    expect(workflowInteractionDiscussionStateSchema.safeParse({
      phase: "conflict_resolution",
      activeSpeakerKey: null,
      speakers: [],
      conflicts: [],
    }).success).toBe(false);
  });

  it("rejects requirement policy without a final-confirm role", () => {
    expect(workflowInteractionPolicySchema.safeParse({
      kind: "requirement_conversation",
      replyRoles: ["task_collaborator"],
      confirmRoles: [],
      structuredFields: [],
    }).success).toBe(false);
  });

  it("requires command id and an exact expected version", () => {
    expect(workflowInteractionCommandSchema.parse({
      commandId: "command_1",
      expectedVersion: 3,
    })).toEqual({ commandId: "command_1", expectedVersion: 3 });
    expect(workflowInteractionCommandSchema.safeParse({
      commandId: "command_1",
      expectedVersion: -1,
    }).success).toBe(false);
  });

  it("tolerates additive response fields for old clients", () => {
    expect(workflowInteractionViewSchema.parse({
      id: "interaction_1",
      projectId: "project_1",
      taskId: "task_1",
      loopRunId: "loop_run_1",
      loopNodeRunId: "node_run_1",
      activationNo: 1,
      kind: "requirement_conversation",
      status: "open",
      version: 1,
      createdAt: "2026-08-05T08:00:00.000Z",
      closedAt: null,
      messages: [],
      decision: null,
      discussionState: {
        phase: "ordinary",
        activeSpeakerKey: null,
        speakers: [{
          speakerKey: "a".repeat(32),
          latestSequence: 1,
          confirmed: true,
          displayName: "Owner",
        }],
        conflicts: [{
          topicKey: "source",
          optionKeys: ["existing", "new"],
          displayLabel: "Source choice",
        }],
        missingConfirmationCount: 0,
      },
      capabilities: {
        canReply: true,
        canConfirmOwnPosition: false,
        canSubmit: true,
        canDelegateConflictSpeaker: false,
        canResolveConflict: false,
        submitReason: "ready",
      },
      futureCapability: true,
    })).toMatchObject({
      id: "interaction_1",
      status: "open",
      discussionState: {
        speakers: [expect.objectContaining({ displayName: "Owner" })],
        conflicts: [expect.objectContaining({ displayLabel: "Source choice" })],
        missingConfirmationCount: 0,
      },
      capabilities: { submitReason: "ready" },
    });
  });
});
