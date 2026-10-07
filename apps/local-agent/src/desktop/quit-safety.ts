export type QuitChoice =
  | "hide_to_tray"
  | "quit"
  | "keep_session_and_quit"
  | "interrupt_and_quit"
  | "cancel";

export interface DesktopQuitState {
  managedRunning: boolean;
  externalSession: boolean;
}

export function resolveQuitChoices(input: {
  managedRunning: boolean;
  externalSession: boolean;
}): QuitChoice[] {
  if (input.managedRunning) {
    return [
      "hide_to_tray",
      ...(input.externalSession ? ["keep_session_and_quit" as const] : []),
      "interrupt_and_quit",
      "cancel",
    ];
  }
  if (input.externalSession) return ["keep_session_and_quit", "cancel"];
  return ["quit", "cancel"];
}

export async function requestDesktopQuit(
  choice: QuitChoice,
  input: {
    invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
  },
): Promise<"requested" | "cancelled"> {
  if (choice === "cancel") return "cancelled";
  if (choice === "hide_to_tray") return "cancelled";
  await input.invoke("quit_desktop", { choice });
  return "requested";
}

export async function readDesktopQuitState(input: {
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
}): Promise<DesktopQuitState> {
  const value = await input.invoke("desktop_quit_state");
  if (
    typeof value !== "object"
    || value === null
    || typeof (value as Record<string, unknown>).managedRunning !== "boolean"
    || typeof (value as Record<string, unknown>).externalSession !== "boolean"
  ) {
    throw new Error("Desktop quit state is invalid");
  }
  return value as DesktopQuitState;
}
