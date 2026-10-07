import { describe, expect, it } from "vitest";
import { describeWorkbenchTimelinePayload } from "./workbench-timeline";

describe("describeWorkbenchTimelinePayload", () => {
  it("extracts command and execution metadata from timeline payload", () => {
    expect(
      describeWorkbenchTimelinePayload({
        command: ["codex", "run"],
        status: "completed",
        exitCode: 0,
        durationSeconds: 120,
      }),
    ).toEqual([
      "命令：codex run",
      "状态：completed",
      "退出码：0",
      "耗时：120s",
    ]);
  });

  it("extracts transfer target information", () => {
    expect(
      describeWorkbenchTimelinePayload({
        targetUserId: "user_peer",
      }),
    ).toEqual(["转交对象：user_peer"]);
  });

  it("returns an empty list for invalid payload values", () => {
    expect(describeWorkbenchTimelinePayload(null)).toEqual([]);
    expect(describeWorkbenchTimelinePayload("invalid")).toEqual([]);
  });
});
