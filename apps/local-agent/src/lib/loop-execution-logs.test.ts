import { describe, expect, it, vi } from "vitest";

import { LoopExecutionLogStore } from "./loop-execution-logs";

function append(store: LoopExecutionLogStore, text: string, loopRunId = "loop_1") {
  return store.append({
    loopRunId,
    nodeKey: "develop",
    stream: "stdout",
    text,
    occurredAt: "2026-08-07T01:00:00.000Z",
  });
}

describe("Loop execution log store", () => {
  it("redacts credential-shaped output before storing it", () => {
    const store = new LoopExecutionLogStore();

    append(store, "OPENAI_API_KEY=secret-value Authorization: Bearer token-value");

    const [entry] = store.read("loop_1");
    expect(entry?.text).toContain("OPENAI_API_KEY=[REDACTED]");
    expect(entry?.text).toContain("Authorization: Bearer [REDACTED]");
    expect(entry?.text).not.toContain("secret-value");
    expect(entry?.text).not.toContain("token-value");
  });

  it("evicts the oldest entries at both count and byte limits", () => {
    const countStore = new LoopExecutionLogStore({ maxEntries: 2, maxBytes: 1_024 });
    append(countStore, "first");
    append(countStore, "second");
    append(countStore, "third");
    expect(countStore.read("loop_1").map(({ text }) => text)).toEqual(["second", "third"]);

    const byteStore = new LoopExecutionLogStore({ maxEntries: 10, maxBytes: 8 });
    append(byteStore, "1234");
    append(byteStore, "5678");
    append(byteStore, "90");
    expect(byteStore.read("loop_1").map(({ text }) => text)).toEqual(["5678", "90"]);
  });

  it("isolates Loop Runs and stops notifying after unsubscribe", () => {
    const store = new LoopExecutionLogStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe("loop_1", listener);

    append(store, "one", "loop_1");
    append(store, "other", "loop_2");
    unsubscribe();
    append(store, "two", "loop_1");

    expect(listener).toHaveBeenCalledOnce();
    expect(store.read("loop_1").map(({ text }) => text)).toEqual(["one", "two"]);
    expect(store.read("loop_2").map(({ text }) => text)).toEqual(["other"]);
  });
});
