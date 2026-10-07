import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveSessionJournal } from "@humanthread/live-session-journal";

import type { CodexTuiBroker } from "./codex-tui-broker";
import { createLiveSessionRuntime } from "./live-session-runtime";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Desktop live session runtime", () => {
  it("publishes broker output only for an opened connector", async () => {
    const root = await mkdtemp(join(tmpdir(), "humanthread-live-runtime-"));
    roots.push(root);
    const broker = {
      session: vi.fn(() => null),
      write: vi.fn(),
    } as unknown as CodexTuiBroker;
    const runtime = createLiveSessionRuntime({
      broker,
      journal: new LiveSessionJournal({ rootDirectory: join(root, "journal") }),
      heartbeatMs: 60_000,
    });

    await expect(runtime.publish({ sessionId: "a".repeat(32), bytes: new Uint8Array([1]) })).resolves.toBeUndefined();
    expect(runtime.state("a".repeat(32))).toBeNull();
  });
});
