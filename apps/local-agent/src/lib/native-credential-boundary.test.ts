import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

async function read(relativePath: string): Promise<string> {
  return readFile(resolve(process.cwd(), relativePath), "utf8");
}

describe("native credential boundary", () => {
  it("ships without persistent credential dependencies and keeps the renderer sandboxed", async () => {
    const packageJson = JSON.parse(await read("package.json")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const pnpmLock = await read("../../pnpm-lock.yaml");
    const mainSource = await read("electron/main.ts");
    const preloadSource = await read("electron/preload.ts");

    expect(packageJson.dependencies).not.toHaveProperty("@tauri-apps/plugin-stronghold");
    expect(packageJson.dependencies).not.toHaveProperty("@tauri-apps/api");
    expect(packageJson.dependencies).not.toHaveProperty("keytar");
    expect(packageJson.devDependencies).toHaveProperty("electron");
    expect(pnpmLock).not.toMatch(/@tauri-apps\//u);
    expect(pnpmLock).not.toMatch(/plugin-stronghold/u);
    expect(preloadSource).toMatch(/contextBridge\.exposeInMainWorld/u);
    expect(mainSource).toMatch(/contextIsolation: true/u);
    expect(mainSource).toMatch(/nodeIntegration: false/u);
    expect(mainSource).toMatch(/sandbox: true/u);
    expect(mainSource).not.toMatch(/nodeIntegration: true/u);
  });

  it("keeps the Loop Worker alive while the macOS window is hidden", async () => {
    const mainSource = await read("electron/main.ts");

    expect(mainSource).toMatch(/backgroundThrottling: false/u);
  });

  it("keeps the desktop version and Windows installer identity stable", async () => {
    const rootPackage = JSON.parse(await read("../../package.json")) as { version: string };
    const localAgentPackage = JSON.parse(await read("package.json")) as { version: string };
    const builderConfig = await read("electron-builder.yml");

    expect(rootPackage.version).toBe("0.1.5");
    expect(localAgentPackage.version).toBe(rootPackage.version);
    expect(builderConfig).toMatch(/^appId: com\.humanthread\.localagent$/mu);
    expect(builderConfig).toMatch(/^productName: HumanThread Desktop$/mu);
    expect(builderConfig).toMatch(/target: msi/u);
    expect(builderConfig).toMatch(/identity: "-"/u);
    expect(builderConfig).toMatch(/hardenedRuntime: false/u);
    expect(builderConfig).not.toMatch(/target: zip/u);
  });

  it("reuses the official HumanThread mark in the renderer and packaged app", async () => {
    const officialMark = await read("../../apps/web/public/brand/humanthread-mark.svg");
    const desktopMark = await read("public/brand/humanthread-mark.svg");
    const desktopLogo = await read("public/brand/humanthread-logo.svg");

    expect(desktopMark).toBe(officialMark);
    expect(desktopLogo).toContain("human thread");
  });

  it("uses relative brand asset paths so the file protocol build does not break logos", async () => {
    const rendererFiles = [
      await read("index.html"),
      await read("src/app/desktop-shell.tsx"),
      await read("src/session/desktop-login.tsx"),
    ];

    expect(rendererFiles.join("\n")).not.toMatch(/(?:src|href)="\/brand\//u);
    expect(rendererFiles.join("\n")).toContain("./brand/humanthread-mark.svg");
    expect(rendererFiles.join("\n")).toContain("./brand/humanthread-logo.svg");
  });
});
