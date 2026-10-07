import { createHash } from "node:crypto";

import {
  workflowInteractionDiscussionMessageSchema,
  workflowInteractionSpeakerKeySchema,
  type WorkflowInteractionConclusion,
  type WorkflowInteractionDiscussionMessage,
} from "@humanthread/shared";

import { derivedPersistenceId } from "./bounded-id";

export interface WorkflowDiscussionMessage {
  sequence: number;
  actorType: string;
  actorId: string;
  actorUserId?: string | null;
  actorDisplayName?: string | null;
  actorAvatarUrl?: string | null;
  body: string;
  answers: Record<string, string[]>;
  discussion?: unknown;
}

export interface WorkflowDiscussionSpeaker {
  speakerKey: string;
  actorUserId: string;
  displayName: string;
  avatarUrl: string | null;
  latestSequence: number;
  latestBody: string;
  latestDigest: string;
  conclusion: WorkflowInteractionConclusion | null;
  confirmed: boolean;
  confirmedSequence: number | null;
  confirmationMessageSequence: number | null;
}

export interface WorkflowDiscussionConflict {
  topicKey: string;
  optionKeys: string[];
  manual?: boolean;
}

export interface WorkflowDiscussionProjection {
  phase: "ordinary" | "conflict_resolution";
  activeSpeakerKey: string | null;
  speakers: WorkflowDiscussionSpeaker[];
  conflicts: WorkflowDiscussionConflict[];
  missingSpeakerKeys: string[];
  missingConfirmationCount: number;
  allSpeakersConfirmed: boolean;
  hasConflict: boolean;
}

export function projectWorkflowDiscussion(input: {
  messages: WorkflowDiscussionMessage[];
  policySnapshot?: unknown;
}): WorkflowDiscussionProjection {
  const policy = discussionPolicy(input.policySnapshot);
  const speakers = new Map<string, WorkflowDiscussionSpeaker>();

  for (const message of [...input.messages].sort((left, right) => left.sequence - right.sequence)) {
    if (message.actorType !== "user") continue;
    const discussion = parseDiscussion(message.discussion);
    if (!discussion) continue;

    const actorUserId = message.actorUserId?.trim() || message.actorId.trim();
    if (!actorUserId) continue;
    const speakerKey = workflowSpeakerKey(actorUserId);

    if (discussion.event === "position") {
      speakers.set(speakerKey, {
        speakerKey,
        actorUserId,
        displayName: message.actorDisplayName?.trim() || actorUserId,
        avatarUrl: message.actorAvatarUrl ?? null,
        latestSequence: message.sequence,
        latestBody: message.body,
        latestDigest: workflowPositionDigest({
          body: message.body,
          answers: message.answers,
          conclusion: discussion.conclusion ?? null,
        }),
        conclusion: discussion.conclusion ?? null,
        confirmed: false,
        confirmedSequence: null,
        confirmationMessageSequence: null,
      });
      continue;
    }

    if (discussion.event !== "speaker_confirmation") continue;
    const speaker = speakers.get(speakerKey);
    if (
      speaker
      && speaker.latestSequence === discussion.positionSequence
      && speaker.latestDigest === discussion.positionDigest
    ) {
      speaker.confirmed = true;
      speaker.confirmedSequence = discussion.positionSequence;
      speaker.confirmationMessageSequence = message.sequence;
    }
  }

  const speakerList = [...speakers.values()];
  const missingSpeakerKeys = speakerList
    .filter((speaker) => !speaker.confirmed)
    .map((speaker) => speaker.speakerKey);
  const conflicts = conclusionConflicts(speakerList);
  if (policy.manualConflict) {
    conflicts.push({
      topicKey: "manual",
      optionKeys: ["conflict_marked", "manual_resolution"],
      manual: true,
    });
  }

  return {
    phase: policy.phase,
    activeSpeakerKey: policy.activeSpeakerKey,
    speakers: speakerList,
    conflicts,
    missingSpeakerKeys,
    missingConfirmationCount: missingSpeakerKeys.length,
    allSpeakersConfirmed: missingSpeakerKeys.length === 0,
    hasConflict: conflicts.length > 0,
  };
}

export function workflowSpeakerKey(actorUserId: string): string {
  return derivedPersistenceId(["workflow-speaker", actorUserId]);
}

export function workflowPositionDigest(input: {
  body: string;
  answers: Record<string, string[]>;
  conclusion: WorkflowInteractionConclusion | null;
}): string {
  return createHash("sha256").update(canonicalJson({
    answers: input.answers,
    body: input.body,
    conclusion: input.conclusion,
  })).digest("hex");
}

function parseDiscussion(value: unknown): WorkflowInteractionDiscussionMessage | null {
  const parsed = workflowInteractionDiscussionMessageSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function discussionPolicy(value: unknown): {
  phase: "ordinary" | "conflict_resolution";
  activeSpeakerKey: string | null;
  manualConflict: boolean;
} {
  const snapshot = record(value);
  const discussion = record(snapshot?.discussion);
  const activeSpeaker = workflowInteractionSpeakerKeySchema.safeParse(discussion?.activeSpeakerKey);
  if (discussion?.phase === "conflict_resolution" && activeSpeaker.success) {
    return {
      phase: "conflict_resolution",
      activeSpeakerKey: activeSpeaker.data,
      manualConflict: discussion.manualConflict === true,
    };
  }
  return {
    phase: "ordinary",
    activeSpeakerKey: null,
    manualConflict: discussion?.manualConflict === true,
  };
}

function conclusionConflicts(speakers: WorkflowDiscussionSpeaker[]): WorkflowDiscussionConflict[] {
  const topics = new Map<string, Set<string>>();
  for (const speaker of speakers) {
    if (!speaker.confirmed || !speaker.conclusion?.exclusive) continue;
    const options = topics.get(speaker.conclusion.topicKey) ?? new Set<string>();
    options.add(speaker.conclusion.optionKey);
    topics.set(speaker.conclusion.topicKey, options);
  }
  return [...topics.entries()]
    .filter(([, options]) => options.size > 1)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([topicKey, options]) => ({ topicKey, optionKeys: [...options].sort() }));
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
