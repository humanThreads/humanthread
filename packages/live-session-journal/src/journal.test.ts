import { mkdtemp, readFile, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { LiveSessionJournal } from "./journal";

const roots: string[] = [];

async function root() {
  const value = await mkdtemp(join(tmpdir(), "humanthread-live-journal-"));
  roots.push(value);
  return value;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true, force: true })));
});

describe("LiveSessionJournal", () => {
  it("appends monotonic sequence chunks and replays only the missing tail", async () => {
    const journal = new LiveSessionJournal({ rootDirectory: await root() });
    const sessionId = "a".repeat(32);
    await journal.append(sessionId, Buffer.from("one"));
    await journal.append(sessionId, Buffer.from("two"));

    await expect(journal.read(sessionId, 1)).resolves.toMatchObject({
      status: "ready",
      firstSequence: 2,
      lastSequence: 2,
      chunks: [{ sequence: 2 }],
    });
  });

  it("keeps active sessions during cleanup and removes expired inactive sessions", async () => {
    const directory = await root();
    const journal = new LiveSessionJournal({ rootDirectory: directory, retentionDays: 30 });
    const active = "b".repeat(32);
    const expired = "c".repeat(32);
    await journal.append(active, Buffer.from("active"));
    await journal.append(expired, Buffer.from("expired"));
    const old = new Date("2026-01-01T00:00:00.000Z");
    await utimes(journal.sessionDirectory(expired), old, old);

    await expect(journal.cleanup({
      activeSessionIds: new Set([active]),
      now: new Date("2026-09-24T00:00:00.000Z"),
    })).resolves.toEqual([expired]);
    await expect(journal.state(active)).resolves.toMatchObject({ lastSequence: 1 });
  });

  it("never writes anything outside the configured session directory", async () => {
    const directory = await root();
    const journal = new LiveSessionJournal({ rootDirectory: directory });
    await expect(journal.append("../../escape", Buffer.from("bad"))).rejects.toMatchObject({
      code: "live_session_invalid",
    });
    await expect(readFile(join(directory, "journal.ndjson"), "utf8")).rejects.toThrow();
  });
});
