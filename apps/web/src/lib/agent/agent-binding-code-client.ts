export interface AgentBindingCodeResponse {
  userId: string;
  teamId: string;
  code: string;
  expiresAt: string;
}

interface AgentBindingCodeSuccessBody extends AgentBindingCodeResponse {
  ok: true;
}

interface AgentBindingCodeErrorBody {
  ok: false;
  error?: string;
}

interface RequestAgentBindingCodeDependencies {
  fetcher?: typeof fetch;
}

export async function requestAgentBindingCode(
  userId: string,
  dependencies: RequestAgentBindingCodeDependencies = {},
): Promise<AgentBindingCodeResponse> {
  const trimmedUserId = userId.trim();

  if (!trimmedUserId) {
    throw new Error("User ID is required");
  }

  const fetcher = dependencies.fetcher ?? fetch;
  const response = await fetcher("/api/agent/binding-code", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      userId: trimmedUserId,
    }),
  });
  const body = (await response.json()) as
    | AgentBindingCodeSuccessBody
    | AgentBindingCodeErrorBody;

  if (!response.ok || body.ok === false) {
    const message =
      body.ok === false ? body.error ?? "Agent binding code failed" : "Agent binding code failed";

    throw new Error(message);
  }

  return {
    userId: body.userId,
    teamId: body.teamId,
    code: body.code,
    expiresAt: body.expiresAt,
  };
}
