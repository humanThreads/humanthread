// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DownloadCatalog } from "./download-catalog";

const macosEntry = {
  version: "1.4.0",
  objectKey: "downloads/desktop/macos/arm64/1.4.0/HumanThread.zip",
  fileName: "HumanThread-1.4.0-macos-arm64.zip",
  size: 12_345_678,
  sha256: "a".repeat(64),
  publishedAt: "2026-08-09T12:00:00.000Z",
};

afterEach(cleanup);

describe("DownloadCatalog", () => {
  it("renders real links only for published artifacts", () => {
    render(<DownloadCatalog catalog={{
      schemaVersion: 1,
      publishedAt: macosEntry.publishedAt,
      artifacts: { "desktop.macos.arm64": macosEntry },
    }} />);
    expect(screen.getByRole("link", { name: /下载 Apple Silicon/i }).getAttribute("href"))
      .toBe("/downloads/artifacts/desktop/macos/arm64");
    expect(screen.getAllByText("尚未发布").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /当前不可下载/ })).toBeNull();
    expect(screen.getByText("Android 手机客户端")).toBeTruthy();
    expect(screen.getByText("Agent CLI")).toBeTruthy();
  });

  it("switches Desktop platforms through accessible tabs", async () => {
    render(<DownloadCatalog catalog={{
      schemaVersion: 1,
      publishedAt: macosEntry.publishedAt,
      artifacts: { "desktop.macos.arm64": macosEntry },
    }} />);

    const macosTab = screen.getByRole("tab", { name: "macOS" });
    const windowsTab = screen.getByRole("tab", { name: "Windows" });
    expect(macosTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel", { name: "macOS" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /下载 Apple Silicon/i })).toBeTruthy();

    await userEvent.click(windowsTab);
    expect(windowsTab.getAttribute("aria-selected")).toBe("true");
    const windowsPanel = screen.getByRole("tabpanel", { name: "Windows" });
    expect(windowsPanel).toBeTruthy();
    expect(screen.queryByRole("link", { name: /下载 Apple Silicon/i })).toBeNull();
    expect(within(windowsPanel).getByText("尚未发布")).toBeTruthy();

    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Linux" }).getAttribute("aria-selected")).toBe("true");
    await userEvent.keyboard("{Home}");
    expect(macosTab.getAttribute("aria-selected")).toBe("true");
  });

  it("shows release metadata and copies SHA256", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<DownloadCatalog catalog={{
      schemaVersion: 1,
      publishedAt: macosEntry.publishedAt,
      artifacts: { "desktop.macos.arm64": macosEntry },
    }} />);
    expect(screen.getByText("1.4.0")).toBeTruthy();
    expect(screen.getByText("11.8 MB")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "复制 Apple Silicon SHA256" }));
    expect(writeText).toHaveBeenCalledWith(macosEntry.sha256);
    expect(screen.getByText("已复制")).toBeTruthy();
  });

  it("shows CLI prerequisites and both local install commands", () => {
    render(<DownloadCatalog catalog={{ schemaVersion: 1, publishedAt: null, artifacts: {} }} />);
    expect(screen.getByText(/Node.js 22\+/)).toBeTruthy();
    expect(screen.getAllByText(/npm install -g/)).toHaveLength(2);
    expect(screen.getByText("ht --help")).toBeTruthy();
  });
});
