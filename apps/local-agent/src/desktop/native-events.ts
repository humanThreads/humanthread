import { reportAgentEvent } from "../lib/api";
import type { LocalPlatform } from "../lib/runtime";
import type { DesktopRuntimeCredentials } from "../session/session-provider";

export interface NativeEventInput {
  taskId: string;
  eventType: "local_opened" | "command_started" | "command_exited";
  message: string;
  payload: Record<string, unknown>;
}

interface DesktopNativeEventSession {
  apiBaseUrl: string;
  userId: string;
  deviceId: string;
  deviceName: string;
}

export async function reportDesktopNativeEvent(
  input: {
    session: DesktopNativeEventSession;
    credentials: DesktopRuntimeCredentials | null;
    platform: LocalPlatform;
    event: NativeEventInput;
  },
  dependencies: { reportAgentEvent: typeof reportAgentEvent } = { reportAgentEvent },
) {
  if (!input.credentials?.deviceToken) {
    throw new Error("当前登录已失效，请重新登录");
  }

  await dependencies.reportAgentEvent({
    apiBaseUrl: input.session.apiBaseUrl,
    apiToken: input.credentials.apiToken,
    deviceToken: input.credentials.deviceToken,
    body: {
      taskId: input.event.taskId,
      actorUserId: input.session.userId,
      eventType: input.event.eventType,
      message: input.event.message,
      payload: input.event.payload,
      localDevice: {
        id: input.session.deviceId,
        name: input.session.deviceName,
        platform: input.platform,
      },
    },
  });
}
