import type {
  AgentDeviceRegisterRequest,
  AgentDeviceRegisterResponse,
  AgentCurrentTaskResponse as SharedAgentCurrentTaskResponse,
  AgentEventReportRequest,
  AgentLoginBindRequest,
  AgentLoginBindResponse,
} from "@humanthread/shared";

export interface AgentCurrentTaskResponse extends SharedAgentCurrentTaskResponse {
  ok: true;
}

export interface AgentApiHealthResponse {
  ok: true;
  service: string;
  db: string;
}

export interface FetchCurrentTaskInput {
  apiBaseUrl: string;
  teamId: string;
  userId: string;
  deviceId: string;
  deviceToken: string;
  apiToken: string;
}

export interface RegisterAgentDeviceInput {
  apiBaseUrl: string;
  apiToken: string;
  deviceToken?: string;
  body: AgentDeviceRegisterRequest;
}

export interface RegisterAgentDeviceResponse extends AgentDeviceRegisterResponse {
  ok: true;
}

export interface LoginAndBindAgentDeviceInput {
  apiBaseUrl: string;
  deviceToken?: string;
  body: AgentLoginBindRequest;
}

export interface LoginAndBindAgentDeviceResponse extends AgentLoginBindResponse {
  ok: true;
}

export interface ReportAgentEventInput {
  apiBaseUrl: string;
  apiToken: string;
  deviceToken: string;
  body: AgentEventReportRequest;
}

export type FetchLike = typeof fetch;

interface ApiDependencies {
  fetch: FetchLike;
}

interface ApiErrorResponse {
  ok?: boolean;
  error?: string;
}

function callFetch(
  fetchImplementation: FetchLike,
  input: Parameters<FetchLike>[0],
  init?: Parameters<FetchLike>[1],
): ReturnType<FetchLike> {
  return Reflect.apply(
    fetchImplementation as unknown as (...args: Parameters<FetchLike>) => ReturnType<FetchLike>,
    globalThis,
    [input, init],
  ) as ReturnType<FetchLike>;
}

function normalizeApiBaseUrl(apiBaseUrl: string): string {
  return apiBaseUrl.trim().replace(/\/+$/u, "");
}

function createHeaders(input: {
  acceptJson: boolean;
  contentTypeJson?: boolean;
  apiToken: string;
  deviceToken?: string;
}): Record<string, string> {
  const headers: Record<string, string> = {};

  if (input.acceptJson) {
    headers.accept = "application/json";
  }

  if (input.contentTypeJson) {
    headers["content-type"] = "application/json";
  }

  if (input.apiToken.trim().length > 0) {
    headers.authorization = `Bearer ${input.apiToken.trim()}`;
  }

  const deviceToken = input.deviceToken?.trim() ?? "";

  if (deviceToken.length > 0) {
    headers["x-agent-device-token"] = deviceToken;
  }

  return headers;
}

async function readApiError(response: Response): Promise<string> {
  try {
    const json = (await response.json()) as ApiErrorResponse;

    if (json.error && json.error.trim().length > 0) {
      return json.error;
    }
  } catch {
    return `Request failed with status ${response.status}`;
  }

  return `Request failed with status ${response.status}`;
}

export async function fetchAgentCurrentTask(
  input: FetchCurrentTaskInput,
  dependencies: ApiDependencies = {
    fetch,
  },
): Promise<AgentCurrentTaskResponse> {
  const params = new URLSearchParams({
    teamId: input.teamId,
    userId: input.userId,
    deviceId: input.deviceId,
  });
  const response = await callFetch(
    dependencies.fetch,
    `${normalizeApiBaseUrl(input.apiBaseUrl)}/api/agent/current-task?${params.toString()}`,
    {
      method: "GET",
      headers: createHeaders({
        acceptJson: true,
        apiToken: input.apiToken,
        deviceToken: input.deviceToken,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(await readApiError(response));
  }

  return (await response.json()) as AgentCurrentTaskResponse;
}

export async function checkAgentApiHealth(
  input: {
    apiBaseUrl: string;
  },
  dependencies: ApiDependencies = {
    fetch,
  },
): Promise<AgentApiHealthResponse> {
  const response = await callFetch(
    dependencies.fetch,
    `${normalizeApiBaseUrl(input.apiBaseUrl)}/api/health/db`,
    {
      method: "GET",
      headers: {
        accept: "application/json",
      },
    },
  );

  if (!response.ok) {
    throw new Error(await readApiError(response));
  }

  return (await response.json()) as AgentApiHealthResponse;
}

export async function registerAgentDevice(
  input: RegisterAgentDeviceInput,
  dependencies: ApiDependencies = {
    fetch,
  },
): Promise<RegisterAgentDeviceResponse> {
  const response = await callFetch(
    dependencies.fetch,
    `${normalizeApiBaseUrl(input.apiBaseUrl)}/api/agent/device/register`,
    {
      method: "POST",
      headers: createHeaders({
        acceptJson: true,
        contentTypeJson: true,
        apiToken: input.apiToken,
        ...(input.deviceToken !== undefined
          ? { deviceToken: input.deviceToken }
          : {}),
      }),
      body: JSON.stringify(input.body),
    },
  );

  if (!response.ok) {
    throw new Error(await readApiError(response));
  }

  return (await response.json()) as RegisterAgentDeviceResponse;
}

export async function loginAndBindAgentDevice(
  input: LoginAndBindAgentDeviceInput,
  dependencies: ApiDependencies = {
    fetch,
  },
): Promise<LoginAndBindAgentDeviceResponse> {
  const response = await callFetch(
    dependencies.fetch,
    `${normalizeApiBaseUrl(input.apiBaseUrl)}/api/agent/login`,
    {
      method: "POST",
      headers: createHeaders({
        acceptJson: true,
        contentTypeJson: true,
        apiToken: "",
        ...(input.deviceToken !== undefined
          ? { deviceToken: input.deviceToken }
          : {}),
      }),
      body: JSON.stringify(input.body),
    },
  );

  if (!response.ok) {
    throw new Error(await readApiError(response));
  }

  return (await response.json()) as LoginAndBindAgentDeviceResponse;
}

export async function reportAgentEvent(
  input: ReportAgentEventInput,
  dependencies: ApiDependencies = {
    fetch,
  },
): Promise<void> {
  const response = await callFetch(
    dependencies.fetch,
    `${normalizeApiBaseUrl(input.apiBaseUrl)}/api/agent/events`,
    {
      method: "POST",
      headers: createHeaders({
        acceptJson: true,
        contentTypeJson: true,
        apiToken: input.apiToken,
        deviceToken: input.deviceToken,
      }),
      body: JSON.stringify(input.body),
    },
  );

  if (!response.ok) {
    throw new Error(await readApiError(response));
  }
}
