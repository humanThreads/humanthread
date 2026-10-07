import { describe, expect, it } from "vitest";

import {
  codexWebSocketUrl,
  parseAppServerListeningEndpoint,
} from "./codex-app-server-transport";

describe("Codex app-server transport", () => {
  it("parses the actual loopback port from daemon stdout", () => {
    const stdout = [
      "codex app-server (WebSockets)",
      "  listening on: ws://127.0.0.1:63570",
      "  readyz: http://127.0.0.1:63570/readyz",
    ].join("\n");

    expect(parseAppServerListeningEndpoint(stdout)).toBe("ws://127.0.0.1:63570");
  });

  it("builds ws+unix for a Unix-domain endpoint and leaves ws unchanged", () => {
    expect(codexWebSocketUrl("unix:///tmp/ht/codex.sock")).toBe("ws+unix:///tmp/ht/codex.sock");
    expect(codexWebSocketUrl("ws://127.0.0.1:63570")).toBe("ws://127.0.0.1:63570");
  });

  it("rejects a non-loopback websocket endpoint", () => {
    expect(() => codexWebSocketUrl("ws://0.0.0.0:63570")).toThrow(
      "Codex app-server endpoint must be loopback",
    );
  });
});
