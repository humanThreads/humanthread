import type { WorkbenchContextIdentity } from "./context";

export function workbenchQueryKey(
  context: WorkbenchContextIdentity,
  domain: string,
  input: Readonly<Record<string, unknown>> = {},
) {
  return [
    context.deploymentKey,
    context.sessionId,
    context.spaceKey,
    domain,
    input,
  ] as const;
}
