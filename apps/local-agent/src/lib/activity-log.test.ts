import { describe, expect, it } from "vitest";
import {
  appendActivityLogEntry,
  type ActivityLogEntry,
} from "./activity-log";

describe("appendActivityLogEntry", () => {
  it("prepends the newest entry and keeps only the configured max items", () => {
    const seed: ActivityLogEntry[] = [
      {
        id: "older",
        title: "older",
        detail: "older detail",
        tone: "neutral",
        createdAt: "2026-05-19T06:00:00.000Z",
      },
      {
        id: "oldest",
        title: "oldest",
        detail: "oldest detail",
        tone: "success",
        createdAt: "2026-05-19T05:59:00.000Z",
      },
    ];

    const result = appendActivityLogEntry(
      seed,
      {
        id: "newest",
        title: "newest",
        detail: "newest detail",
        tone: "warning",
        createdAt: "2026-05-19T06:01:00.000Z",
      },
      2,
    );

    expect(result).toEqual([
      {
        id: "newest",
        title: "newest",
        detail: "newest detail",
        tone: "warning",
        createdAt: "2026-05-19T06:01:00.000Z",
      },
      {
        id: "older",
        title: "older",
        detail: "older detail",
        tone: "neutral",
        createdAt: "2026-05-19T06:00:00.000Z",
      },
    ]);
  });

  it("uses a safe default limit when max entries is invalid", () => {
    const result = appendActivityLogEntry(
      [],
      {
        id: "single",
        title: "single",
        detail: "single detail",
        tone: "success",
        createdAt: "2026-05-19T06:02:00.000Z",
      },
      0,
    );

    expect(result).toEqual([
      {
        id: "single",
        title: "single",
        detail: "single detail",
        tone: "success",
        createdAt: "2026-05-19T06:02:00.000Z",
      },
    ]);
  });
});
