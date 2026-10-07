import { describe, expect, it } from "vitest";
import {
  isLoopGraphEnabled,
  readLoopGraphFeatureFlags,
} from "./loop-feature-flags";

describe("readLoopGraphFeatureFlags", () => {
  it("keeps graph-v1 disabled by default", () => {
    expect(readLoopGraphFeatureFlags({})).toEqual({
      graphV1: false,
    });
  });

  it("enables graph-v1 for every Project when the global flag is true", () => {
    expect(
      readLoopGraphFeatureFlags({
        HUMANTHREAD_LOOP_GRAPH_V1: "true",
      }),
    ).toEqual({
      graphV1: true,
    });
  });

  it.each(["TRUE", "TrUe"]) ("accepts case-insensitive true: %s", (value) => {
    expect(readLoopGraphFeatureFlags({ HUMANTHREAD_LOOP_GRAPH_V1: value }).graphV1).toBe(true);
  });

  it.each([undefined, "", "false", "1", " true "]) (
    "keeps graph-v1 disabled for %j",
    (value) => {
      expect(readLoopGraphFeatureFlags({ HUMANTHREAD_LOOP_GRAPH_V1: value }).graphV1).toBe(false);
    },
  );

  it("allows every Project while graph-v1 is enabled", () => {
    const flags = readLoopGraphFeatureFlags({
      HUMANTHREAD_LOOP_GRAPH_V1: "true",
      HUMANTHREAD_LOOP_PROJECT_ALLOWLIST: "project_1",
    });

    expect(isLoopGraphEnabled(flags)).toBe(true);
    expect(isLoopGraphEnabled({ ...flags, graphV1: false })).toBe(false);
  });
});
