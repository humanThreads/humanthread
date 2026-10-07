import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import App from "./App";
import { ONBOARDING_STORAGE_KEY, createDefaultOnboardingState } from "./onboarding/onboarding-state";
import { createFixtureFetch } from "./test/fixtures";

async function login() {
  const user = userEvent.setup();
  window.history.replaceState({}, "", "/");
  render(<App fetch={createFixtureFetch() as typeof fetch} storage={localStorage} />);
  await user.type(screen.getByLabelText("登录邮箱"), "person@example.com");
  await user.type(screen.getByLabelText("登录密码"), "password");
  await user.click(screen.getByRole("button", { name: "登录并进入工作台" }));
  return user;
}

describe("Desktop first-run routing", () => {
  beforeEach(() => localStorage.clear());

  it("opens the onboarding wizard after first login instead of falling through to the dashboard", async () => {
    await login();
    expect(await screen.findByRole("heading", { level: 1, name: "登录与设备身份" })).toBeInTheDocument();
  });

  it("respects an explicitly skipped onboarding state", async () => {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify({
      ...createDefaultOnboardingState(),
      skipped: true,
    }));
    await login();
    expect(await screen.findByRole("heading", { level: 1, name: "首页" })).toBeInTheDocument();
  });
});
