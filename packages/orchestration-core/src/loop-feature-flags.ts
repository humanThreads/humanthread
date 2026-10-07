export interface LoopGraphFeatureFlags {
  graphV1: boolean;
}

export function readLoopGraphFeatureFlags(
  environment: Readonly<Record<string, string | undefined>>,
): LoopGraphFeatureFlags {
  return {
    graphV1: environment.HUMANTHREAD_LOOP_GRAPH_V1?.toLowerCase() === "true",
  };
}

export function isLoopGraphEnabled(
  flags: LoopGraphFeatureFlags,
): boolean {
  return flags.graphV1;
}
