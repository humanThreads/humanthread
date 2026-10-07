import { createServer } from "node:net";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  checkPortAvailable,
  findAvailablePort,
  stopChildProcess,
  waitForHttpReady,
} from "./e2e-server";

class MockChildProcess extends EventEmitter {
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  kill = vi.fn((signal?: NodeJS.Signals) => {
    this.signalCode = signal ?? null;
    this.exitCode = 0;
    queueMicrotask(() => {
      this.emit("exit", this.exitCode, this.signalCode);
    });
    return true;
  });

  onExit(
    listener: (exitCode: number | null, signal: NodeJS.Signals | null) => void,
  ): void {
    super.once("exit", listener);
  }
}

describe("checkPortAvailable", () => {
  it("returns false when the target port is already occupied", async () => {
    const server = createServer();

    await new Promise<void>((resolve, reject) => {
      server.listen(0, "127.0.0.1", () => resolve());
      server.once("error", reject);
    });

    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Failed to allocate a test port.");
    }

    await expect(checkPortAvailable(address.port)).resolves.toBe(false);

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  });
});

describe("findAvailablePort", () => {
  it("skips occupied ports and returns the next available port", async () => {
    const isPortAvailable = vi
      .fn<(_: number) => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await expect(
      findAvailablePort(
        {
          preferredPort: 3010,
        },
        {
          isPortAvailable,
        },
      ),
    ).resolves.toBe(3011);

    expect(isPortAvailable).toHaveBeenNthCalledWith(1, 3010);
    expect(isPortAvailable).toHaveBeenNthCalledWith(2, 3011);
  });

  it("throws when no usable port can be found in the scan window", async () => {
    const isPortAvailable = vi
      .fn<(_: number) => Promise<boolean>>()
      .mockResolvedValue(false);

    await expect(
      findAvailablePort(
        {
          preferredPort: 3010,
          maxAttempts: 2,
        },
        {
          isPortAvailable,
        },
      ),
    ).rejects.toThrow("Failed to find an available port starting at 3010.");
  });
});

describe("stopChildProcess", () => {
  it("does nothing when the child process has already exited", async () => {
    const child = new MockChildProcess();
    child.exitCode = 0;

    await stopChildProcess({
      exitCode: child.exitCode,
      signalCode: child.signalCode,
      kill: child.kill,
      once: (_event, listener) => {
        child.onExit(listener);
      },
    });

    expect(child.kill).not.toHaveBeenCalled();
  });

  it("sends SIGTERM and waits for exit when the child process is still running", async () => {
    const child = new MockChildProcess();

    await stopChildProcess({
      exitCode: child.exitCode,
      signalCode: child.signalCode,
      kill: child.kill,
      once: (_event, listener) => {
        child.onExit(listener);
      },
    });

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });
});

describe("waitForHttpReady", () => {
  it("fails fast when the server exits before the health endpoint becomes ready", async () => {
    await expect(
      waitForHttpReady(
        {
          baseUrl: "http://127.0.0.1:3011",
          serverExit: Promise.resolve({
            exitCode: 1,
            signal: null,
          }),
          timeoutMs: 5_000,
          pollMs: 1,
        },
        {
          fetchImpl: vi.fn(
            async () =>
              await new Promise<Response>(() => {}),
          ),
        },
      ),
    ).rejects.toThrow(
      "Server exited before becoming ready: http://127.0.0.1:3011 (code=1, signal=none)",
    );
  });
});
