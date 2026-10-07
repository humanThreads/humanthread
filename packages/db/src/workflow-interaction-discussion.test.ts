import { describe, expect, it } from "vitest";

import { projectWorkflowDiscussion } from "./workflow-interaction-discussion";

const positionADigest = "f1337fb9ca7bf4eea5e9f4cc5e6635205b8f24eb685ac80d95a7b1861b5e7ed7";
const existingSourceDigest = "08ee1c4f3b1e8a45a9e87a09ffe3fa1a539916763b3f45e9ff2411dcd9c71c83";
const newSourceDigest = "d5fa66d8644ee4d8b60ca55e4137170fe35811ae74b8c427f7ce20fc2feb14de";

function message(overrides: Record<string, unknown>) {
  return {
    sequence: 1,
    actorType: "user",
    actorId: "user_a",
    actorUserId: "user_a",
    actorDisplayName: "Alice",
    actorAvatarUrl: null,
    body: "意见 A",
    answers: {},
    discussion: { event: "position" },
    ...overrides,
  };
}

describe("workflow interaction discussion projection", () => {
  it("ignores Agent, system, and non-position messages when deriving speakers", () => {
    const projection = projectWorkflowDiscussion({
      messages: [
        message({ actorType: "agent", actorId: "agent_1" }),
        message({ sequence: 2, actorType: "system", actorId: "system_1" }),
        message({ sequence: 3, discussion: undefined }),
      ],
    });

    expect(projection).toMatchObject({
      phase: "ordinary",
      activeSpeakerKey: null,
      speakers: [],
      conflicts: [],
      missingSpeakerKeys: [],
      missingConfirmationCount: 0,
      allSpeakersConfirmed: true,
      hasConflict: false,
    });
  });

  it("confirms only the matching speaker's latest position", () => {
    const projection = projectWorkflowDiscussion({
      messages: [
        message({ sequence: 1 }),
        message({
          sequence: 2,
          body: "",
          discussion: {
            event: "speaker_confirmation",
            positionSequence: 1,
            positionDigest: positionADigest,
          },
        }),
      ],
    });

    expect(projection.speakers).toEqual([expect.objectContaining({
      speakerKey: "4694a77b445ce31a90944f1c773e24c3",
      actorUserId: "user_a",
      displayName: "Alice",
      latestSequence: 1,
      latestDigest: positionADigest,
      confirmed: true,
      confirmedSequence: 1,
    })]);
    expect(projection.missingConfirmationCount).toBe(0);
  });

  it("invalidates only that speaker's confirmation after a newer position", () => {
    const projection = projectWorkflowDiscussion({
      messages: [
        message({ sequence: 1 }),
        message({
          sequence: 2,
          body: "",
          discussion: {
            event: "speaker_confirmation",
            positionSequence: 1,
            positionDigest: positionADigest,
          },
        }),
        message({ sequence: 3, actorId: "user_b", actorUserId: "user_b", actorDisplayName: "Bob", body: "意见 B" }),
        message({
          sequence: 4,
          actorId: "user_b",
          actorUserId: "user_b",
          actorDisplayName: "Bob",
          body: "",
          discussion: {
            event: "speaker_confirmation",
            positionSequence: 3,
            positionDigest: "0".repeat(64),
          },
        }),
        message({ sequence: 5, body: "意见 A（补充）" }),
      ],
    });

    expect(projection.speakers).toEqual([
      expect.objectContaining({ actorUserId: "user_a", latestSequence: 5, confirmed: false }),
      expect.objectContaining({ actorUserId: "user_b", latestSequence: 3, confirmed: false }),
    ]);
    expect(projection.missingSpeakerKeys).toEqual([
      "4694a77b445ce31a90944f1c773e24c3",
      "1d75a39530fa24d3443fc28c406f0e49",
    ]);
  });

  it("keeps matching confirmed conclusions conflict-free", () => {
    const projection = projectWorkflowDiscussion({
      messages: [
        message({
          sequence: 1,
          body: "选择现有源码",
          discussion: { event: "position", conclusion: { topicKey: "source", optionKey: "existing", exclusive: true } },
        }),
        message({
          sequence: 2,
          body: "",
          discussion: { event: "speaker_confirmation", positionSequence: 1, positionDigest: existingSourceDigest },
        }),
        message({
          sequence: 3,
          actorId: "user_b",
          actorUserId: "user_b",
          actorDisplayName: "Bob",
          body: "选择现有源码",
          discussion: { event: "position", conclusion: { topicKey: "source", optionKey: "existing", exclusive: true } },
        }),
        message({
          sequence: 4,
          actorId: "user_b",
          actorUserId: "user_b",
          actorDisplayName: "Bob",
          body: "",
          discussion: { event: "speaker_confirmation", positionSequence: 3, positionDigest: existingSourceDigest },
        }),
      ],
    });

    expect(projection.allSpeakersConfirmed).toBe(true);
    expect(projection.conflicts).toEqual([]);
  });

  it("reports different confirmed exclusive conclusions as a conflict", () => {
    const projection = projectWorkflowDiscussion({
      messages: [
        message({
          sequence: 1,
          body: "选择现有源码",
          discussion: { event: "position", conclusion: { topicKey: "source", optionKey: "existing", exclusive: true } },
        }),
        message({
          sequence: 2,
          body: "",
          discussion: { event: "speaker_confirmation", positionSequence: 1, positionDigest: existingSourceDigest },
        }),
        message({
          sequence: 3,
          actorId: "user_b",
          actorUserId: "user_b",
          actorDisplayName: "Bob",
          body: "新建手机应用",
          discussion: { event: "position", conclusion: { topicKey: "source", optionKey: "new", exclusive: true } },
        }),
        message({
          sequence: 4,
          actorId: "user_b",
          actorUserId: "user_b",
          actorDisplayName: "Bob",
          body: "",
          discussion: { event: "speaker_confirmation", positionSequence: 3, positionDigest: newSourceDigest },
        }),
      ],
    });

    expect(projection).toMatchObject({
      allSpeakersConfirmed: true,
      hasConflict: true,
      conflicts: [{ topicKey: "source", optionKeys: ["existing", "new"] }],
    });
  });

  it("projects manual conflict and the active conflict speaker from policy state", () => {
    const projection = projectWorkflowDiscussion({
      messages: [],
      policySnapshot: {
        discussion: {
          phase: "conflict_resolution",
          activeSpeakerKey: "03da991f458247f9a32710f13bb7bd97",
          manualConflict: true,
        },
      },
    });

    expect(projection).toMatchObject({
      phase: "conflict_resolution",
      activeSpeakerKey: "03da991f458247f9a32710f13bb7bd97",
      hasConflict: true,
      conflicts: [{
        topicKey: "manual",
        optionKeys: ["conflict_marked", "manual_resolution"],
        manual: true,
      }],
    });
  });
});
