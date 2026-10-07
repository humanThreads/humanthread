import type { QueryClient } from "@tanstack/react-query";
import type { WorkbenchContextIdentity } from "@humanthread/workbench-client";

import { workbenchContextQueryPrefix } from "../lib/query-client";

export async function switchWorkbenchContext<T>(
  nextContext: WorkbenchContextIdentity,
  dependencies: {
    previousContext: WorkbenchContextIdentity;
    queryClient: QueryClient;
    bootstrap: (context: WorkbenchContextIdentity) => Promise<T>;
    setActionsEnabled: (enabled: boolean) => void;
  },
): Promise<T> {
  dependencies.setActionsEnabled(false);
  const previousPrefix = workbenchContextQueryPrefix(dependencies.previousContext);

  await dependencies.queryClient.cancelQueries({ queryKey: previousPrefix });
  dependencies.queryClient.removeQueries({ queryKey: previousPrefix });
  const bootstrap = await dependencies.bootstrap(nextContext);

  dependencies.setActionsEnabled(true);
  return bootstrap;
}
