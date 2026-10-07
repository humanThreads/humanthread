import { describe, expect, it } from "vitest";

import {
  normalizeDesktopRoute,
  selectDesktopStartupRoute,
} from "./route-restore";

describe("desktop route restoration", () => {
  it("keeps authorized desktop collection and detail routes", () => {
    expect(normalizeDesktopRoute("/dashboard")).toBe("/dashboard");
    expect(normalizeDesktopRoute("/tasks/task_1?view=detail")).toBe(
      "/tasks/task_1?view=detail",
    );
    expect(normalizeDesktopRoute("/documents/doc_1")).toBe("/documents/doc_1");
    expect(normalizeDesktopRoute("/projects/project_1?tab=roadmap")).toBe(
      "/projects/project_1?tab=roadmap",
    );
    expect(normalizeDesktopRoute("/onboarding")).toBe("/onboarding");
  });

  it("rejects external, malformed and unknown restoration targets", () => {
    expect(normalizeDesktopRoute("https://attacker.example/tasks/task_1")).toBeNull();
    expect(normalizeDesktopRoute("//attacker.example/tasks/task_1")).toBeNull();
    expect(normalizeDesktopRoute("/admin/secrets")).toBeNull();
  });

  it("prefers a valid explicit route and otherwise falls back deterministically", () => {
    expect(selectDesktopStartupRoute({
      overrideRoute: "/notifications?item=notice_1",
      lastSuccessfulRoute: "/projects/project_1",
    })).toBe("/notifications?item=notice_1");
    expect(selectDesktopStartupRoute({
      overrideRoute: "https://attacker.example",
      lastSuccessfulRoute: "/projects/project_1",
    })).toBe("/projects/project_1");
    expect(selectDesktopStartupRoute({ lastSuccessfulRoute: "/unknown" }))
      .toBe("/dashboard");
  });

  it("forces first-run onboarding before restoring another route", () => {
    expect(selectDesktopStartupRoute({
      overrideRoute: "/tasks",
      lastSuccessfulRoute: "/projects/project_1",
      onboardingRequired: true,
    })).toBe("/onboarding");
    expect(selectDesktopStartupRoute({
      lastSuccessfulRoute: "/projects/project_1",
      onboardingRequired: false,
    })).toBe("/projects/project_1");
  });
});
