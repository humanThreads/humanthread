export function describeWorkbenchTimelinePayload(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const record = payload as Record<string, unknown>;
  const lines: string[] = [];

  if (Array.isArray(record.command)) {
    lines.push(`命令：${record.command.join(" ")}`);
  }

  if (typeof record.status === "string") {
    lines.push(`状态：${record.status}`);
  }

  if (typeof record.exitCode === "number") {
    lines.push(`退出码：${record.exitCode}`);
  }

  if (typeof record.durationSeconds === "number") {
    lines.push(`耗时：${record.durationSeconds}s`);
  }

  if (typeof record.targetUserId === "string") {
    lines.push(`转交对象：${record.targetUserId}`);
  }

  return lines;
}
