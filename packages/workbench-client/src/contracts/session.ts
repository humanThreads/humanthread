import { z } from "zod";

export const desktopUserSchema = z.object({
  id: z.string().min(1),
  email: z.email(),
  name: z.string().min(1),
  avatarUrl: z.string().min(1).nullable(),
});

export const desktopDeviceSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["authorized", "pending", "revoked"]),
  deviceToken: z.string().min(1),
});

export const desktopLoginResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    accessToken: z.string().min(1),
    accessExpiresAt: z.iso.datetime(),
    refreshToken: z.string().min(1),
    sessionId: z.string().min(1),
    user: desktopUserSchema,
    device: desktopDeviceSchema,
  }),
});

export const desktopRefreshResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    accessToken: z.string().min(1),
    accessExpiresAt: z.iso.datetime(),
    refreshToken: z.string().min(1),
    sessionId: z.string().min(1),
  }),
});

export const desktopSpaceSchema = z.object({
  key: z.string().min(1),
  kind: z.enum(["personal", "company"]),
  name: z.string().min(1),
});

export const desktopCurrentTaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  status: z.string().min(1),
});

export const desktopBootstrapResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    spaces: z.array(desktopSpaceSchema),
    activeSpaceKey: z.string().min(1),
    currentTask: desktopCurrentTaskSchema.nullable(),
    capabilities: z.object({
      nativeExecution: z.boolean(),
    }),
  }),
});

export type DesktopUser = z.infer<typeof desktopUserSchema>;
export type DesktopDevice = z.infer<typeof desktopDeviceSchema>;
export type DesktopLoginResponse = z.infer<typeof desktopLoginResponseSchema>;
export type DesktopRefreshResponse = z.infer<typeof desktopRefreshResponseSchema>;
export type DesktopBootstrapResponse = z.infer<typeof desktopBootstrapResponseSchema>;
