import { describe, expect, it } from "vitest";

import {
  appendWorkflowInteractionMessageBodySchema,
  delegateWorkflowConflictSpeakerBodySchema,
} from "./workflow-interaction-http";

describe("workflow interaction HTTP contracts", () => {
  const request = {
    commandId: "interaction-message:1",
    message: {
      body: "采用方案 A。",
      answers: {},
      attachmentIds: [],
      mentionedUserIds: [],
    },
  };

  it("accepts append commands without an aggregate version", () => {
    expect(appendWorkflowInteractionMessageBodySchema.parse(request)).toEqual(request);
  });

  it("rejects the removed append expectedVersion field", () => {
    expect(appendWorkflowInteractionMessageBodySchema.safeParse({
      ...request,
      expectedVersion: 2,
    }).success).toBe(false);
  });

  it("requires one bounded participant identity for conflict speaker delegation", () => {
    expect(delegateWorkflowConflictSpeakerBodySchema.parse({
      commandId: "delegate:user_a",
      expectedVersion: 2,
      speakerUserId: "user_a",
    })).toEqual({
      commandId: "delegate:user_a",
      expectedVersion: 2,
      speakerUserId: "user_a",
    });
    expect(delegateWorkflowConflictSpeakerBodySchema.safeParse({
      commandId: "delegate:user_a",
      expectedVersion: 2,
      speakerUserId: "",
    }).success).toBe(false);
  });
});
