export function parseStageId(stageId: string): { loopId: string; subloopId: string } {
  const parts = stageId.trim().split("/");
  if (parts.length !== 2 || parts.some((part) => !part.trim())) {
    throw Object.assign(new Error("Stage must use <loop-id>/<subloop-id>"), { code: "invalid_stage_identity" });
  }
  return { loopId: parts[0]!, subloopId: parts[1]! };
}
