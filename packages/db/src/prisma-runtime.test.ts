import { describe, expect, it, vi } from "vitest";
import { createPrismaRuntime } from "./prisma-runtime";

type TestClient = {
  id: string;
  $disconnect: () => Promise<void>;
};

function createTestClient(
  id: string,
  disconnect: () => Promise<void> = async () => undefined,
): TestClient {
  return {
    id,
    $disconnect: vi.fn(disconnect),
  };
}

describe("Prisma client runtime", () => {
  it("creates one lazy current client", () => {
    const client = createTestClient("initial");
    const createClient = vi.fn(() => client);
    const runtime = createPrismaRuntime({ createClient });

    expect(createClient).not.toHaveBeenCalled();
    expect(runtime.getClient()).toBe(client);
    expect(runtime.getClient()).toBe(client);
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it("shares one recovery and publishes the replacement before cleanup finishes", async () => {
    let finishDisconnect: (() => void) | undefined;
    const disconnectPending = new Promise<void>((resolve) => {
      finishDisconnect = resolve;
    });
    const initial = createTestClient("initial", () => disconnectPending);
    const replacement = createTestClient("replacement");
    const createClient = vi
      .fn<() => TestClient>()
      .mockReturnValueOnce(initial)
      .mockReturnValueOnce(replacement);
    const runtime = createPrismaRuntime({ createClient });
    runtime.getClient();

    const recoveryA = runtime.recoverClient();
    const recoveryB = runtime.recoverClient();
    await Promise.resolve();

    expect(recoveryA).toBe(recoveryB);
    expect(runtime.getClient()).toBe(replacement);
    expect(initial.$disconnect).toHaveBeenCalledTimes(1);
    expect(createClient).toHaveBeenCalledTimes(2);
    await expect(recoveryA).resolves.toBe(replacement);

    finishDisconnect?.();
    await disconnectPending;
  });

  it("allows another recovery after the replacement factory fails", async () => {
    const initial = createTestClient("initial");
    const replacement = createTestClient("replacement");
    const createClient = vi
      .fn<() => TestClient>()
      .mockReturnValueOnce(initial)
      .mockImplementationOnce(() => {
        throw new Error("factory failed");
      })
      .mockReturnValueOnce(replacement);
    const runtime = createPrismaRuntime({ createClient });
    runtime.getClient();

    await expect(runtime.recoverClient()).rejects.toThrow("factory failed");
    expect(runtime.getClient()).toBe(initial);
    await expect(runtime.recoverClient()).resolves.toBe(replacement);
  });

  it("reuses a newer client when a stale client reports failure later", async () => {
    const initial = createTestClient("initial");
    const replacement = createTestClient("replacement");
    const createClient = vi
      .fn<() => TestClient>()
      .mockReturnValueOnce(initial)
      .mockReturnValueOnce(replacement);
    const runtime = createPrismaRuntime({ createClient });
    runtime.getClient();

    await expect(runtime.recoverClient(initial)).resolves.toBe(replacement);
    await expect(runtime.recoverClient(initial)).resolves.toBe(replacement);
    expect(createClient).toHaveBeenCalledTimes(2);
  });

  it("keeps the replacement when old-client cleanup fails", async () => {
    const cleanupError = new Error("cleanup failed");
    const initial = createTestClient("initial", async () => {
      throw cleanupError;
    });
    const replacement = createTestClient("replacement");
    const onDisconnectError = vi.fn();
    const createClient = vi
      .fn<() => TestClient>()
      .mockReturnValueOnce(initial)
      .mockReturnValueOnce(replacement);
    const runtime = createPrismaRuntime({ createClient, onDisconnectError });
    runtime.getClient();

    await expect(runtime.recoverClient()).resolves.toBe(replacement);
    expect(runtime.getClient()).toBe(replacement);
    expect(onDisconnectError).toHaveBeenCalledWith(cleanupError);
  });
});
