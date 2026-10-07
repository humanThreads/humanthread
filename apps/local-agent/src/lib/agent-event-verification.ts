import type { AgentTaskEventType } from "@humanthread/shared";

const REQUIRED_PAYLOAD_KEYS = {
  local_opened: ["cwd"],
  command_started: ["cwd", "command", "processId", "shell"],
  command_exited: ["cwd", "command", "processId", "shell", "status", "exitCode"],
} as const satisfies Record<AgentTaskEventType, readonly string[]>;

export type SupportedLocalAgentEventType = keyof typeof REQUIRED_PAYLOAD_KEYS;

export interface AgentEventPayloadValidationResult {
  eventType: SupportedLocalAgentEventType;
  valid: boolean;
  missingKeys: string[];
  requiredKeys: string[];
}

export function isSupportedLocalAgentEventType(
  value: string,
): value is SupportedLocalAgentEventType {
  return value in REQUIRED_PAYLOAD_KEYS;
}

export function getRequiredPayloadKeys(
  eventType: SupportedLocalAgentEventType,
): string[] {
  return [...REQUIRED_PAYLOAD_KEYS[eventType]];
}

export function validateAgentEventPayload(
  eventType: SupportedLocalAgentEventType,
  payload: unknown,
): AgentEventPayloadValidationResult {
  const requiredKeys = getRequiredPayloadKeys(eventType);
  const record =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};

  const missingKeys = requiredKeys.filter((key) => !(key in record));

  return {
    eventType,
    valid: missingKeys.length === 0,
    missingKeys,
    requiredKeys,
  };
}

