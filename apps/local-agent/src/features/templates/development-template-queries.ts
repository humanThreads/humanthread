import { z } from "zod";

export const developmentTemplateItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.string().min(1),
  version: z.number().int().positive(),
  status: z.enum(["draft", "published", "deprecated"]),
  origin: z.enum(["platform", "space"]),
  spaceId: z.string().min(1).nullable(),
  description: z.string().nullable(),
  revision: z.number().int().positive(),
  createdByUserId: z.string().min(1).nullable().optional(),
  isPublic: z.boolean().optional(),
  industryTags: z.array(z.string()).optional(),
  starCount: z.number().int().nonnegative().optional(),
}).passthrough();

export const developmentTemplateMarketResponseSchema = z.object({
  ok: z.literal(true),
  result: z.object({
    templates: z.array(developmentTemplateItemSchema),
    starredTemplateIds: z.array(z.string()),
  }),
});

export const developmentTemplateCollectionResponseSchema = z.object({
  ok: z.literal(true),
  result: z.object({
    templates: z.array(developmentTemplateItemSchema),
    loopVersions: z.array(z.unknown()),
    agentProfiles: z.array(z.unknown()),
  }),
});

export const developmentTemplateMutationResponseSchema = z.object({
  ok: z.literal(true),
  result: z.record(z.string(), z.unknown()),
});

export type DevelopmentTemplateItem = z.infer<typeof developmentTemplateItemSchema>;

export function resolveDevelopmentTemplateSpaceId(input: {
  spaceKey: string;
  userId: string;
}): string {
  if (input.spaceKey === "personal") return `space:personal:${input.userId}`;
  if (input.spaceKey.startsWith("company:")) return `space:${input.spaceKey}`;
  return input.spaceKey;
}
