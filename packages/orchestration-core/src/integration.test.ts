import { describe, expect, it } from "vitest";
import { requestMergeApproval } from "./integration";

describe("integration gate", () => {
  it("binds approval to the exact branch head and base", () => {
    expect(requestMergeApproval({ taskId: "t1", branchName: "ht/run/r1", headCommit: "head", baseCommit: "base", checksPassed: true, cleanDiff: true })).toEqual({ required: true, type: "merge", fingerprint: "ht/run/r1:head:base", taskId: "t1" });
  });
});
