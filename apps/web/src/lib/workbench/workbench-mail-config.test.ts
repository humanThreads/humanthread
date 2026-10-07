import { describe, expect, it } from "vitest";
import { getWorkbenchGlobalSmtpConfig } from "./workbench-mail-config";

describe("workbench global SMTP config", () => {
  it("loads the global SMTP configuration from environment variables", () => {
    expect(
      getWorkbenchGlobalSmtpConfig({
        HUMANTHREAD_SMTP_HOST: " smtp.example.com ",
        HUMANTHREAD_SMTP_PORT: "465",
        HUMANTHREAD_SMTP_USERNAME: " noreply@example.com ",
        HUMANTHREAD_SMTP_PASSWORD: " eCtwH54aSzgv0GWf ",
      }),
    ).toEqual({
      host: "smtp.example.com",
      port: 465,
      username: "noreply@example.com",
      password: "eCtwH54aSzgv0GWf",
    });
  });

  it("returns null when the SMTP config is incomplete or invalid", () => {
    expect(
      getWorkbenchGlobalSmtpConfig({
        HUMANTHREAD_SMTP_HOST: "smtp.example.com",
        HUMANTHREAD_SMTP_PORT: "invalid",
        HUMANTHREAD_SMTP_USERNAME: "noreply@example.com",
        HUMANTHREAD_SMTP_PASSWORD: "secret",
      }),
    ).toBeNull();
    expect(getWorkbenchGlobalSmtpConfig({})).toBeNull();
  });
});
