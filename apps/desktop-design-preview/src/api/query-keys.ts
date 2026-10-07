export interface PreviewQueryContext {
  sessionId: string;
  spaceKey: string;
}

export function previewQueryKey(
  context: PreviewQueryContext | null,
  domain: string,
  parameters: Readonly<Record<string, unknown>> = {},
) {
  return context
    ? ["desktop-preview", context.sessionId, context.spaceKey, domain, parameters] as const
    : ["desktop-preview", "inactive", domain, parameters] as const;
}
