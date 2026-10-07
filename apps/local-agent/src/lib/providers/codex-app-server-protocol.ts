export const MAX_JSON_RPC_LINE_BYTES = 4 * 1024 * 1024;

export type JsonRpcId = number | string;

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: unknown;
};

export type JsonRpcNotification = {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
};

export type JsonRpcError = {
  code: number;
  message: string;
  data?: unknown;
};

export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: JsonRpcError;
};

type JsonRpcInboundRequest = Omit<JsonRpcRequest, "jsonrpc"> & { jsonrpc?: "2.0" };
type JsonRpcInboundNotification = Omit<JsonRpcNotification, "jsonrpc"> & { jsonrpc?: "2.0" };
type JsonRpcInboundResponse = Omit<JsonRpcResponse, "jsonrpc"> & { jsonrpc?: "2.0" };

export type JsonRpcMessage = JsonRpcInboundRequest | JsonRpcInboundNotification | JsonRpcInboundResponse;

function protocolError(message: string): Error {
  return Object.assign(new Error(`Codex app-server protocol error: ${message}`), {
    code: "provider_protocol_error",
  });
}

function isValidId(value: unknown): value is JsonRpcId {
  return (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
    || (typeof value === "string" && value.length > 0 && value.length <= 128);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateMethod(value: unknown): asserts value is string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 256
    || /[\u0000-\u001F\u007F]/u.test(value)
  ) throw protocolError("method is invalid");
}

function validateError(value: unknown): asserts value is JsonRpcError {
  if (!isRecord(value) || typeof value.code !== "number" || !Number.isSafeInteger(value.code) || typeof value.message !== "string") {
    throw protocolError("error is invalid");
  }
}

export function parseJsonRpcLine(line: string): JsonRpcMessage {
  if (typeof line !== "string") throw protocolError("message is not text");
  if (new TextEncoder().encode(line).byteLength > MAX_JSON_RPC_LINE_BYTES) {
    throw protocolError("message size exceeds the limit");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw protocolError("message is not valid JSON");
  }
  if (!isRecord(parsed) || (parsed.jsonrpc !== undefined && parsed.jsonrpc !== "2.0")) {
    throw protocolError("jsonrpc must be 2.0");
  }

  const hasMethod = Object.prototype.hasOwnProperty.call(parsed, "method");
  const hasResult = Object.prototype.hasOwnProperty.call(parsed, "result");
  const hasError = Object.prototype.hasOwnProperty.call(parsed, "error");
  const hasId = Object.prototype.hasOwnProperty.call(parsed, "id");
  if (hasMethod && (hasResult || hasError)) throw protocolError("message must be a request or response, not both");
  if (!hasMethod && !hasResult && !hasError) throw protocolError("message is neither a request or response");

  if (hasMethod) {
    validateMethod(parsed.method);
    if (hasId && !isValidId(parsed.id)) throw protocolError("id is invalid");
    return parsed as JsonRpcInboundRequest | JsonRpcInboundNotification;
  }

  if (!hasId || !isValidId(parsed.id) || (hasResult === hasError)) throw protocolError("response id or result is invalid");
  if (hasError) validateError(parsed.error);
  return parsed as JsonRpcInboundResponse;
}

export function serializeJsonRpcRequest(input: {
  id: JsonRpcId;
  method: string;
  params?: unknown;
}): string {
  if (!isValidId(input.id)) throw protocolError("request id is invalid");
  validateMethod(input.method);
  const request: JsonRpcRequest = {
    jsonrpc: "2.0",
    id: input.id,
    method: input.method,
    ...(input.params === undefined ? {} : { params: input.params }),
  };
  const serialized = `${JSON.stringify(request)}\n`;
  if (new TextEncoder().encode(serialized).byteLength > MAX_JSON_RPC_LINE_BYTES) {
    throw protocolError("request size exceeds the limit");
  }
  return serialized;
}
