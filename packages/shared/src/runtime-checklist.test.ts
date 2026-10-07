import { describe, expect, it } from "vitest";
import { parseRuntimeChecklistMessage } from "./runtime-checklist";

describe("runtime checklist protocol", () => {
  it("parses only a valid fenced checklist and normalizes null reason", () => {
    expect(parseRuntimeChecklistMessage([
      "Working through the task.",
      "```json",
      JSON.stringify({ humanThreadChecklist: [
        { id: "inspect", title: "Inspect repository", status: "not_started", reason: null },
        { id: "test", title: "Run tests", status: "failed", reason: "Tests are unavailable", evidenceRefs: [] },
      ] }),
      "```",
    ].join("\n"))).toEqual([
      { id: "inspect", title: "Inspect repository", status: "not_started", evidenceRefs: [] },
      { id: "test", title: "Run tests", status: "failed", reason: "Tests are unavailable", evidenceRefs: [] },
    ]);
  });

  it("ignores natural language, malformed JSON, duplicate ids, and invalid statuses", () => {
    expect(parseRuntimeChecklistMessage("I will inspect the repository.")).toBeNull();
    expect(parseRuntimeChecklistMessage("```json\n{broken\n```" )).toBeNull();
    expect(parseRuntimeChecklistMessage("```json\n" + JSON.stringify({ humanThreadChecklist: [
      { id: "same", title: "One", status: "not_started" },
      { id: "same", title: "Two", status: "not_started" },
    ] }) + "\n```" )).toBeNull();
    expect(parseRuntimeChecklistMessage("```json\n" + JSON.stringify({ humanThreadChecklist: [
      { id: "item", title: "Item", status: "done" },
    ] }) + "\n```" )).toBeNull();
  });
});
