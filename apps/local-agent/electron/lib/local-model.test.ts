import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  accountDirectory,
  deleteAgentCredential,
  getAgentCredentialStatus,
  md5Hex,
  normalizeDeploymentOrigin,
  testAndRefreshModelSite,
  readAgentCredential,
  setAgentCredential,
} from "./local-model";

function encodedJson(value: unknown): ArrayBuffer {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

const CREDENTIAL_REF = "0123456789abcdef0123456789abcdef";
let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "humanthread-home-"));
  vi.stubEnv("HOME", home);
  vi.stubEnv("USERPROFILE", home);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

describe("local model account scope", () => {
  it("normalizes deployment origins and derives a SHA-256 scoped directory", () => {
    const origin = normalizeDeploymentOrigin("http://localhost:3000/");
    expect(origin).toBe("http://localhost:3000");

    const first = accountDirectory(origin, "user-1");
    const second = accountDirectory(origin, "user-2");
    const otherOrigin = accountDirectory("https://other.example.com", "user-1");
    expect(first).toContain(join(".humanthread", "accounts"));
    expect(first).not.toBe(second);
    expect(first).not.toBe(otherOrigin);
    expect(first.split("/").pop()).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("computes lowercase MD5 digests for model keys", () => {
    expect(md5Hex(Buffer.from("hello"))).toBe("5d41402abc4b2a76b9719d911017c592");
  });
});

describe("local model credentials", () => {
  it("stores, reports and deletes credentials without exposing them elsewhere", () => {
    expect(
      getAgentCredentialStatus({
        deploymentOrigin: "http://localhost:3000",
        userId: "user-1",
        credentialRef: CREDENTIAL_REF,
      }).configured,
    ).toBe(false);

    const written = setAgentCredential({
      deploymentOrigin: "http://localhost:3000",
      userId: "user-1",
      credentialRef: CREDENTIAL_REF,
      kind: "openai_api_key",
      apiKey: "sk-secret-value",
    });
    expect(written.configured).toBe(true);
    expect(JSON.stringify(written)).not.toContain("sk-secret-value");
    expect(
      readAgentCredential("http://localhost:3000", "user-1", CREDENTIAL_REF),
    ).toBe("sk-secret-value");

    if (process.platform !== "win32") {
      const path = join(accountDirectory("http://localhost:3000", "user-1"), "credentials.json");
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(readFileSync(path, "utf8")).toContain("sk-secret-value");
    }

    const deleted = deleteAgentCredential({
      deploymentOrigin: "http://localhost:3000",
      userId: "user-1",
      credentialRef: CREDENTIAL_REF,
    });
    expect(deleted.configured).toBe(false);
    expect(() =>
      readAgentCredential("http://localhost:3000", "user-1", CREDENTIAL_REF),
    ).toThrow("Local credential is not configured");
  });

  it("rejects malformed credential references", () => {
    expect(() =>
      setAgentCredential({
        deploymentOrigin: "http://localhost:3000",
        userId: "user-1",
        credentialRef: "UPPERCASE",
        kind: "openai_api_key",
        apiKey: "key",
      }),
    ).toThrow("Credential input is invalid");
  });
});

describe("model site discovery", () => {
  it("refreshes a compatible catalog and derives stable model keys", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => encodedJson({
        data: [
          { id: "gpt-5.6-terra", name: "Terra" },
          { id: "gpt-5.6-terra", name: "Duplicate" },
        ],
      }),
    }));
    const catalog = await testAndRefreshModelSite({
      deploymentOrigin: "http://localhost:3000",
      userId: "user-1",
      site: {
        siteId: "abcdef0123456789abcdef0123456789",
        name: "Company models",
        adapter: "openai_compatible",
        baseUrl: "https://models.example.com/v1",
        credentialSource: "environment",
        credentialRef: null,
        status: "untested",
        lastValidatedAt: null,
      },
      credential: "one-time-key",
      fetch: fetchImpl,
    });

    expect(catalog.models).toHaveLength(1);
    expect(catalog.models[0]?.name).toBe("gpt-5.6-terra");
    expect(catalog.models[0]?.modelKey).toBe(
      md5Hex(Buffer.concat([
        Buffer.from("abcdef0123456789abcdef0123456789"),
        Buffer.from([0]),
        Buffer.from("gpt-5.6-terra"),
      ])),
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://models.example.com/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer one-time-key" }),
      }),
    );
  });

  it("fails closed when discovery returns an invalid payload", async () => {
    await expect(testAndRefreshModelSite({
      deploymentOrigin: "http://localhost:3000",
      userId: "user-1",
      site: {
        siteId: "abcdef0123456789abcdef0123456789",
        name: "Company models",
        adapter: "openai_compatible",
        baseUrl: "https://models.example.com/v1",
        credentialSource: "environment",
        credentialRef: null,
        status: "untested",
        lastValidatedAt: null,
      },
      credential: "one-time-key",
      fetch: vi.fn(async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => encodedJson({ unexpected: true }),
      })),
    })).rejects.toThrow("Model catalog response is invalid");
  });
});
