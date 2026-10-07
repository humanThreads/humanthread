import { describe, expect, it } from "vitest";

import { parseHtArgs } from "./ht-args";

describe("parseHtArgs", () => {
  it("uses an interactive password prompt by default and supports explicit stdin", () => {
    expect(parseHtArgs(["login", "--email", "person@example.com"])).toEqual({
      command: "login",
      email: "person@example.com",
      passwordStdin: false,
      json: false,
    });
    expect(parseHtArgs(["login", "--email", "person@example.com", "--password-stdin"])).toEqual({
      command: "login",
      email: "person@example.com",
      passwordStdin: true,
      json: false,
    });
  });

  it("parses init and project identity", () => {
    expect(parseHtArgs(["init", "--project", "project_1", "--json"])).toEqual({
      command: "init",
      projectId: "project_1",
      json: true,
    });
  });

  it("requires a scoped stage for repair", () => {
    expect(() => parseHtArgs(["repair"])).toThrow("--stage");
    expect(parseHtArgs(["repair", "--stage", "loop_1/node_1"])).toEqual({ command: "repair", stageId: "loop_1/node_1", json: false });
  });

  it("requires a scoped stage for explicit migration", () => {
    expect(() => parseHtArgs(["migrate"])).toThrow("--stage");
    expect(parseHtArgs(["migrate", "--stage", "loop_1/node_1"])).toEqual({ command: "migrate", stageId: "loop_1/node_1", json: false });
  });

  it("requires explicit resident Worker transport and state arguments", () => {
    expect(() => parseHtArgs(["worker", "run"])).toThrow("--platform-url");
    expect(parseHtArgs([
      "worker", "run",
      "--platform-url", "http://localhost:3000",
      "--pool-token-env", "HT_WORKER_POOL_TOKEN",
      "--state-dir", "/var/lib/humanthread",
    ])).toEqual({
      command: "worker_run",
      platformUrl: "http://localhost:3000",
      poolTokenEnv: "HT_WORKER_POOL_TOKEN",
      stateDir: "/var/lib/humanthread",
      json: false,
    });
  });
});
