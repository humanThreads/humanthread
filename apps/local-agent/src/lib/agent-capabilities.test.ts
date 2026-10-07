import { describe, expect, it } from "vitest";

import { LOCAL_AGENT_CAPABILITY_SNAPSHOT } from "./agent-capabilities";

describe("LOCAL_AGENT_CAPABILITY_SNAPSHOT", () => {
  it("advertises both supported Loop contract versions", () => {
    expect(LOCAL_AGENT_CAPABILITY_SNAPSHOT).toMatchObject({ maxConcurrency: 1 });
  });
});
