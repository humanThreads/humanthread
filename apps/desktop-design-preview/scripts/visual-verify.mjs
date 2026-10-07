import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

import { createFixtureFetch } from "../src/test/fixtures.ts";

const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const screenshotDir = resolve(repoRoot, "docs/requirements/assets/desktop-design-preview");
const port = 4174;
const baseUrl = `http://127.0.0.1:${port}`;
const fixtureFetch = createFixtureFetch();

const server = spawn(
  "pnpm",
  [
    "--dir",
    "apps/desktop-design-preview",
    "exec",
    "vite",
    "--host",
    "0.0.0.0",
    "--port",
    String(port),
    "--strictPort",
  ],
  {
    cwd: repoRoot,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  },
);

let serverOutput = "";
server.stdout.on("data", (chunk) => {
  serverOutput += String(chunk);
});
server.stderr.on("data", (chunk) => {
  serverOutput += String(chunk);
});

async function waitForServer() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Vite exited before becoming ready.\n${serverOutput}`);
    }
    try {
      const response = await fetch(baseUrl, { signal: AbortSignal.timeout(1_500) });
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error("Timed out waiting for the visual verification server.");
}

async function capturePage(page, screenshotName) {
  const screenshot = await page.screenshot({
    path: resolve(screenshotDir, screenshotName),
    fullPage: true,
  });
  const metrics = await page.evaluate(() => ({
    bodyWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
    unnamedButtons: [...document.querySelectorAll("button")].filter((button) => {
      const label = button.getAttribute("aria-label")?.trim();
      const text = button.textContent?.trim();
      return !label && !text;
    }).length,
  }));
  assert.ok(
    metrics.bodyWidth <= metrics.viewportWidth + 1,
    `${screenshotName} overflows horizontally: ${metrics.bodyWidth} > ${metrics.viewportWidth}`,
  );
  assert.equal(metrics.unnamedButtons, 0, `${screenshotName} contains unnamed buttons.`);
  return createHash("sha256").update(screenshot).digest("hex");
}

async function navigateViaSidebar(page, width, navigationName) {
  if (width <= 1040) {
    await page.getByRole("button", { name: "打开主导航" }).click();
  }
  await page.getByRole("link", { exact: true, name: navigationName }).click();
}

async function verifySpaPage(page, width, navigationName, headingName, screenshotName) {
  await navigateViaSidebar(page, width, navigationName);
  await page.getByRole("heading", { exact: true, level: 1, name: headingName }).waitFor();
  await page.waitForLoadState("networkidle");
  return capturePage(page, screenshotName);
}

async function verifyViewport(browser, width) {
  const context = await browser.newContext({
    viewport: { width, height: width === 760 ? 900 : 960 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const fulfillFromFixture = async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const mockResponse = await fixtureFetch(`${url.pathname}${url.search}`, {
      method: request.method(),
      headers: request.headers(),
      body: request.postData() ?? undefined,
    });
    await route.fulfill({
      status: mockResponse.status,
      headers: Object.fromEntries(mockResponse.headers.entries()),
      body: await mockResponse.text(),
    });
  };
  await page.route("**/api/desktop/**", fulfillFromFixture);
  await page.route("**/api/development-templates/**", fulfillFromFixture);

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  const screenshotHashes = [await capturePage(page, `登录-${width}.png`)];
  await page.getByLabel("登录邮箱").fill("person@example.com");
  await page.getByLabel("登录密码").fill("visual-check");
  await page.getByRole("button", { name: "登录并进入工作台" }).click();
  await page.getByRole("heading", { exact: true, level: 1, name: "登录与设备身份" }).waitFor();
  screenshotHashes.push(await capturePage(page, `开箱向导-${width}.png`));
  await navigateViaSidebar(page, width, "首页");
  await page.getByRole("heading", { exact: true, level: 1, name: "首页" }).waitFor();
  screenshotHashes.push(await capturePage(page, `首页-${width}.png`));
  screenshotHashes.push(await verifySpaPage(page, width, "任务", "任务", `任务-${width}.png`));
  screenshotHashes.push(await verifySpaPage(page, width, "Agents", "Agents", `Agents-${width}.png`));
  screenshotHashes.push(await verifySpaPage(page, width, "文档", "文档", `文档-${width}.png`));
  await navigateViaSidebar(page, width, "模板库");
  await page.getByRole("heading", { exact: true, level: 1, name: "模板库" }).waitFor();
  const templateGrid = await page.locator(".template-grid").evaluate((element) => ({
    columns: getComputedStyle(element).gridTemplateColumns.split(" ").filter(Boolean).length,
    display: getComputedStyle(element).display,
  }));
  assert.equal(templateGrid.display, "grid");
  assert.ok(templateGrid.columns > 1, `Template cards collapsed to one column at ${width}px.`);
  screenshotHashes.push(await capturePage(page, `模板库-${width}.png`));
  screenshotHashes.push(await verifySpaPage(page, width, "设置", "设置", `设置-${width}.png`));
  assert.ok(
    new Set(screenshotHashes).size >= 5,
    `Viewport ${width}px produced too many identical screenshots.`,
  );
  await context.close();
}

await mkdir(screenshotDir, { recursive: true });
try {
  await waitForServer();
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--disable-dev-shm-usage"],
  });
  try {
    for (const width of [1440, 1024, 760]) {
      await verifyViewport(browser, width);
    }
  } finally {
    await browser.close();
  }
  await writeFile(
    resolve(screenshotDir, "visual-verification.json"),
    `${JSON.stringify({ verifiedAt: new Date().toISOString(), widths: [1440, 1024, 760] }, null, 2)}\n`,
  );
  console.log(`Visual verification passed: ${screenshotDir}`);
} finally {
  if (server.exitCode === null) {
    if (process.platform === "win32" || !server.pid) {
      server.kill("SIGTERM");
    } else {
      process.kill(-server.pid, "SIGTERM");
    }
  }
}
