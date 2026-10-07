import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CodexAppServerDiagnostics } from "./codex-app-server-diagnostics";

const invokeMock = vi.fn();

vi.mock("../../lib/native-bridge", () => ({
  getNativeBridge: () => ({
    isNative: true,
    platform: "darwin",
    invoke: invokeMock,
  }),
}));

describe("Codex app-server diagnostics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows sanitized local process state and never renders a credential or path", async () => {
    invokeMock.mockResolvedValue([{
      processKey: "codex:one",
      generation: 4,
      pid: 123,
      bindingFingerprint: "a".repeat(64),
      model: "gpt-5.6-terra",
      reasoningEffort: "high",
      transport: "stdio",
      status: "ready",
      lastNotificationAt: 1234,
      pendingRequestCount: 1,
      stderrSummary: "provider_error",
      lastErrorCode: null,
    }]);

    render(<CodexAppServerDiagnostics enabled />);

    expect(await screen.findByText("gpt-5.6-terra · high")).toBeVisible();
    expect(screen.getByText(/就绪 · PID 123 · generation 4 · pending 1/u)).toBeVisible();
    expect(screen.queryByText(/api[_-]?key|secret|Users/iu)).not.toBeInTheDocument();
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("list_codex_app_servers"));
  });
});
