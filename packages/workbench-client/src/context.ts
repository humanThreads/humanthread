export interface WorkbenchContextIdentity {
  deploymentKey: string;
  sessionId: string;
  spaceKey: string;
}

export interface CreateWorkbenchContextIdentityInput {
  deploymentUrl: string;
  sessionId: string;
  spaceKey: string;
}

function requireIdentitySegment(name: string, value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new TypeError(`${name} is required`);
  }
  return normalized;
}

function canonicalizeDeploymentUrl(value: string): string {
  const url = new URL(requireIdentitySegment("deploymentUrl", value));
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new TypeError("deploymentUrl must use HTTP or HTTPS");
  }
  return url.toString().replace(/\/$/u, "");
}

export function createWorkbenchContextIdentity(
  input: CreateWorkbenchContextIdentityInput,
): WorkbenchContextIdentity {
  return {
    deploymentKey: canonicalizeDeploymentUrl(input.deploymentUrl),
    sessionId: requireIdentitySegment("sessionId", input.sessionId),
    spaceKey: requireIdentitySegment("spaceKey", input.spaceKey),
  };
}
