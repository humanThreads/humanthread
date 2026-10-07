import { describe, expect, it } from "vitest";
import { stringify } from "yaml";

import { detectV1Migration, explicitV1MigrationReportPath } from "./migration";

function pristineV1Files() {
  return {
    "node.yaml": stringify({
      schemaVersion: 1,
      loopId: "loop_project",
      nodeId: "node_develop",
      configured: false,
      instructions: "rules.md",
      prompt: "prompt.md",
      skillsDirectory: "skills",
      outputSchema: "schemas/output.schema.json",
      checks: [],
    }),
    "rules.md": "# Develop Rules\n\nConfigure this node for the current project.\n",
    "prompt.md": "Execute the Develop node for this project.\n",
    "schemas/output.schema.json": `${JSON.stringify({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      additionalProperties: false,
      properties: {},
    }, null, 2)}\n`,
  };
}

describe("detectV1Migration", () => {
  it("keeps report paths distinct when normalized Stage IDs would collide", () => {
    expect(explicitV1MigrationReportPath("loop/a", "dev"))
      .not.toBe(explicitV1MigrationReportPath("loop-a", "dev"));
  });

  it("automatically migrates only the exact built-in v1 template", () => {
    expect(detectV1Migration({ files: pristineV1Files() })).toEqual({ kind: "automatic" });
  });

  it.each([
    ["changed rule", { ...pristineV1Files(), "rules.md": "用户规则\n" }],
    ["extra project file", { ...pristineV1Files(), "notes.md": "user notes\n" }],
    ["missing template file", Object.fromEntries(Object.entries(pristineV1Files()).filter(([path]) => path !== "prompt.md"))],
  ])("blocks %s without proposing writes", (_case, files) => {
    expect(detectV1Migration({ files })).toMatchObject({
      kind: "blocked",
      code: "migration_required",
      writes: [],
    });
  });
});
