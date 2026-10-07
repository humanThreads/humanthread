import { z } from "zod";
import { describe, expect, it } from "vitest";

import { parseForwardCompatibleResponse } from "./response-compatibility";

const responseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    items: z.array(z.object({
      id: z.string().min(1),
      version: z.number().int().positive(),
    }).strict()),
  }).strict(),
}).strict();

const discriminatedResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    target: z.discriminatedUnion("resourceType", [
      z.object({
        resourceType: z.literal("project"),
        resourceId: z.string().min(1),
      }).strict(),
      z.object({
        resourceType: z.literal("task"),
        resourceId: z.string().min(1),
      }).strict(),
    ]),
  }).strict(),
}).strict();

describe("forward-compatible Desktop response parsing", () => {
  it("strips unknown fields recursively without mutating the response body", () => {
    const body = {
      ok: true,
      futureEnvelopeField: "ignored",
      data: {
        futureDataField: "ignored",
        items: [{ id: "item_1", version: 1, futureItemField: "ignored" }],
      },
    };

    expect(parseForwardCompatibleResponse(responseSchema, body)).toEqual({
      ok: true,
      data: { items: [{ id: "item_1", version: 1 }] },
    });
    expect(body).toHaveProperty("futureEnvelopeField", "ignored");
    expect(body.data.items[0]).toHaveProperty("futureItemField", "ignored");
  });

  it("still rejects invalid known fields after removing unknown fields", () => {
    expect(() => parseForwardCompatibleResponse(responseSchema, {
      ok: true,
      futureEnvelopeField: "ignored",
      data: {
        items: [{ id: "item_1", version: 0, futureItemField: "ignored" }],
      },
    })).toThrow();
  });

  it("strips future fields from the selected discriminated-union branch", () => {
    expect(parseForwardCompatibleResponse(discriminatedResponseSchema, {
      ok: true,
      data: {
        target: {
          resourceType: "project",
          resourceId: "project_1",
          futureTargetField: "ignored",
        },
      },
    })).toEqual({
      ok: true,
      data: {
        target: {
          resourceType: "project",
          resourceId: "project_1",
        },
      },
    });
  });

  it("still rejects missing required response fields", () => {
    expect(() => parseForwardCompatibleResponse(responseSchema, {
      ok: true,
      data: {
        items: [{ version: 1, futureItemField: "ignored" }],
      },
    })).toThrow();
  });
});
