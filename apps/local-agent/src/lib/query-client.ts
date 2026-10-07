import { QueryClient } from "@tanstack/react-query";
import type { WorkbenchContextIdentity } from "@humanthread/workbench-client";

export function createDesktopQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: 15_000,
      },
    },
  });
}

export function workbenchContextQueryPrefix(
  context: WorkbenchContextIdentity,
): readonly [string, string, string] {
  return [context.deploymentKey, context.sessionId, context.spaceKey];
}
