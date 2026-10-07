import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { networkInterfaces } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const port = 4174;
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
      const response = await fetch(`http://127.0.0.1:${port}/`, {
        signal: AbortSignal.timeout(1_500),
      });
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error("Timed out waiting for the Desktop preview server.");
}

function lanAddresses() {
  return Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address);
}

async function verify() {
  await waitForServer();
  const addresses = lanAddresses();
  assert.ok(addresses.length > 0, "No non-loopback IPv4 interface is available.");

  for (const address of addresses) {
    const url = `http://${address}:${port}/`;
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    assert.equal(response.status, 200, `${url} did not return 200.`);
    const html = await response.text();
    assert.match(html, /HumanThread Desktop 设计预览/u);
    console.log(`LAN verified: ${url}`);
  }
}

try {
  await verify();
} finally {
  if (server.exitCode === null) {
    if (process.platform === "win32" || !server.pid) {
      server.kill("SIGTERM");
    } else {
      process.kill(-server.pid, "SIGTERM");
    }
  }
}
