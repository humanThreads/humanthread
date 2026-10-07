export interface AgentTokenResponse {
  userId: string;
  token: string;
}

interface AgentTokenSuccessBody extends AgentTokenResponse {
  ok: true;
}

interface AgentTokenErrorBody {
  ok: false;
  error?: string;
}

interface RequestAgentTokenDependencies {
  fetcher?: typeof fetch;
}

export async function requestAgentToken(
  userId: string,
  dependencies: RequestAgentTokenDependencies = {},
): Promise<AgentTokenResponse> {
  const trimmedUserId = userId.trim();

  if (!trimmedUserId) {
    throw new Error("User ID is required");
  }

  const fetcher = dependencies.fetcher ?? fetch;
  const response = await fetcher("/api/agent/token", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      userId: trimmedUserId,
    }),
  });

  const body = (await response.json()) as AgentTokenSuccessBody | AgentTokenErrorBody;

  if (!response.ok) {
    const message =
      body.ok === false ? body.error ?? "Agent token rotation failed" : "Agent token rotation failed";

    throw new Error(message);
  }

  if (body.ok === false) {
    throw new Error(body.error ?? "Agent token rotation failed");
  }

  return {
    userId: body.userId,
    token: body.token,
  };
}
