import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createWorkerOutbox, redactWorkerPayload } from "./worker-outbox";

describe("Worker outbox", () => {
  it("redacts runtime credentials even when they appear in ordinary text", () => {
    const redacted = redactWorkerPayload({ message: "git-token-value and configured-key" }, "", 0, ["git-token-value", "configured-key"]);
    expect(JSON.stringify(redacted)).toBe('{"message":"[redacted] and [redacted]"}');
  });

  it("persists bounded redacted events without retaining runtime credentials", async () => {
    const directory = await mkdtemp(join(tmpdir(), "humanthread-worker-outbox-"));
    const outbox = createWorkerOutbox({ directory, maxRecords: 2, maxBytes: 8 * 1024 });

    await outbox.enqueue({
      type: "stage.started",
      payload: {
        apiKey: "configured-key",
        authorization: "Bearer configured-key",
        poolToken: "htwp_bootstrap_value",
        nested: { OPENAI_API_KEY: "configured-key" },
      },
    });
    await outbox.enqueue({ type: "stage.progress", payload: { step: 1 } });
    await outbox.enqueue({ type: "stage.completed", payload: { ok: true } });

    const records = await outbox.read();
    expect(records).toHaveLength(2);
    expect(records.map(({ type }) => type)).toEqual(["stage.progress", "stage.completed"]);
    expect(JSON.stringify(records)).not.toContain("configured-key");
    expect(JSON.stringify(records)).not.toContain("htwp_bootstrap_value");
    expect(await readFile(join(directory, "outbox.json"), "utf8")).not.toContain("configured-key");
  });

  it("drops records past the configured retention period before replay", async () => {
    const directory = await mkdtemp(join(tmpdir(), "humanthread-worker-outbox-"));
    let now = new Date("2026-08-24T08:00:00.000Z");
    const outbox = createWorkerOutbox({ directory, maxRecords: 10, maxBytes: 8 * 1024, maxAgeMs: 1_000, now: () => now });

    await outbox.enqueue({ type: "stage.started", payload: {} });
    now = new Date("2026-08-24T08:00:01.001Z");

    await expect(outbox.read()).resolves.toEqual([]);
    await expect(readFile(join(directory, "outbox.json"), "utf8")).resolves.toBe("[]");
  });
});
