import { describe, expect, it } from "vitest";

import { calculateNextKnowledgeSchedule, parseKnowledgeCron } from "./knowledge-schedule";

describe("knowledge schedule", () => {
  it("calculates the next Asia/Shanghai run and stable dedupe key", () => {
    const result = calculateNextKnowledgeSchedule({
      projectDigest: "a".repeat(32),
      rule: "15 2 * * *",
      timezone: "Asia/Shanghai",
      now: new Date("2026-09-20T17:00:00.000Z"),
    });
    expect(result.nextAt).toEqual(new Date("2026-09-20T18:15:00.000Z"));
    expect(result.due).toBe(false);
    expect(result.scheduledFor).toBe("2026-09-21T02:15");
    expect(result.dedupeKey).toMatch(/^knowledge-schedule:[a-f0-9]{32}$/u);
  });

  it("supports ranges, lists, and steps", () => {
    expect(parseKnowledgeCron("*/15 9-18/2 * * *")).toEqual({
      minute: [0, 15, 30, 45],
      hour: [9, 11, 13, 15, 17],
    });
  });

  it("skips an already scheduled minute and validates malformed rules", () => {
    const result = calculateNextKnowledgeSchedule({
      projectDigest: "a".repeat(32),
      rule: "0 9 * * *",
      timezone: "Asia/Shanghai",
      now: new Date("2026-09-20T01:00:00.000Z"),
      lastScheduledFor: new Date("2026-09-20T01:00:00.000Z"),
    });
    expect(result.scheduledFor).toBe("2026-09-21T09:00");
    expect(result.due).toBe(false);
    expect(() => parseKnowledgeCron("bad")).toThrow(/five fields/u);
    expect(() => parseKnowledgeCron("0 9 1 * *")).toThrow(/minute and hour/u);
  });
});
