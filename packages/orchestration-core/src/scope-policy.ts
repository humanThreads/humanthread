type Policy = { allowedPaths: string[]; allowedTools: string[] };

function validPath(path: string): boolean {
  return Boolean(path) && !path.startsWith("/") && !path.split("/").includes("..");
}

function matches(path: string, pattern: string): boolean {
  if (!validPath(path) || !validPath(pattern)) return false;
  if (pattern === "**") return true;
  const prefix = pattern.endsWith("/**") ? pattern.slice(0, -3) : pattern;
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function validateExecutionPolicy(input: { taskScope: Policy; profilePolicy: Policy; approvalGrants: Array<{ tool?: string; path?: string }>; requested: { path: string; tool: string } }) {
  const pathAllowed = input.taskScope.allowedPaths.some((pattern) => matches(input.requested.path, pattern)) && input.profilePolicy.allowedPaths.some((pattern) => matches(input.requested.path, pattern));
  const toolAllowed = input.taskScope.allowedTools.includes(input.requested.tool) && input.profilePolicy.allowedTools.includes(input.requested.tool);
  const granted = input.approvalGrants.some((grant) => (!grant.tool || grant.tool === input.requested.tool) && (!grant.path || matches(input.requested.path, grant.path)));
  return pathAllowed && (toolAllowed || granted) ? { ok: true as const } : { ok: false as const, code: "policy_denied" as const, approvalType: pathAllowed ? "tool_permission" as const : "scope_change" as const };
}
