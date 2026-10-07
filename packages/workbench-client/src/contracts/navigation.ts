import { z } from "zod";

export const workbenchNavigationKeySchema = z.enum([
  "dashboard",
  "tasks",
  "agents",
  "notifications",
  "team",
  "projects",
  "documents",
  "reports",
  "templates",
  "settings",
]);

export type WorkbenchNavigationKey = z.infer<typeof workbenchNavigationKeySchema>;
