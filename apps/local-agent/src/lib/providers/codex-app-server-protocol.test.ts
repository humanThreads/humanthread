import { describe, expect, it } from "vitest";
import {
  parseJsonRpcLine,
  serializeJsonRpcRequest,
} from "./codex-app-server-protocol";

describe("Codex app-server JSON-RPC protocol", () => {
  it("parses a response and preserves unknown fields", () => {
    expect(parseJsonRpcLine('{"jsonrpc":"2.0","id":4,"result":{"ok":true},"future":1}\n'))
      .toEqual({ jsonrpc: "2.0", id: 4, result: { ok: true }, future: 1 });
  });

  it("parses current Codex app-server messages without a jsonrpc member", () => {
    expect(parseJsonRpcLine('{"id":1,"result":{"userAgent":"codex_cli_rs"}}'))
      .toEqual({ id: 1, result: { userAgent: "codex_cli_rs" } });
    expect(parseJsonRpcLine('{"method":"configWarning","params":{"details":null}}'))
      .toEqual({ method: "configWarning", params: { details: null } });
  });

  it("rejects an unsupported explicit JSON-RPC version", () => {
    expect(() => parseJsonRpcLine('{"jsonrpc":"1.0","id":1,"result":{}}'))
      .toThrow(/jsonrpc must be 2\.0/u);
  });

  it("rejects an invalid JSON-RPC id and an oversized line", () => {
    expect(() => parseJsonRpcLine('{"jsonrpc":"2.0","id":-1,"result":null}'))
      .toThrow(/id/u);
    expect(() => parseJsonRpcLine("x".repeat(4 * 1024 * 1024 + 1)))
      .toThrow(/size/u);
  });

  it("serializes a request without shell quoting", () => {
    expect(serializeJsonRpcRequest({
      id: 7,
      method: "thread/start",
      params: { model: "gpt" },
    })).toBe('{"jsonrpc":"2.0","id":7,"method":"thread/start","params":{"model":"gpt"}}\n');
  });

  it("rejects messages that are neither requests nor responses", () => {
    expect(() => parseJsonRpcLine('{"jsonrpc":"2.0","id":1,"method":"thread/start","result":{}}'))
      .toThrow(/request or response/u);
  });
});
