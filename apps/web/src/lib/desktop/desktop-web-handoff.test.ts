import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  consumeDesktopWebHandoff,
  issueDesktopWebHandoff,
  type DesktopWebHandoffRecord,
  type DesktopWebHandoffRepository,
} from "./desktop-web-handoff";

const issuedAt = new Date("2026-07-27T08:00:00.000Z");

function createMemoryRepository(): DesktopWebHandoffRepository & {
  records: Map<string, DesktopWebHandoffRecord>;
} {
  const records = new Map<string, DesktopWebHandoffRecord>();
  return {
    records,
    async create(input) {
      records.set(input.id, {
        ...input,
        userEmail: "owner@example.com",
      });
    },
    async findByCodeHash(codeHash) {
      return [...records.values()].find((record) => record.codeHash === codeHash) ?? null;
    },
    async consume({ id, codeHash, now }) {
      const record = records.get(id);
      if (
        !record ||
        record.codeHash !== codeHash ||
        record.consumedAt ||
        record.expiresAt <= now
      ) {
        return null;
      }
      const consumed = { ...record, consumedAt: now };
      records.set(id, consumed);
      return consumed;
    },
  };
}

function dependencies(repository: DesktopWebHandoffRepository) {
  return {
    repository,
    now: () => issuedAt,
    createCode: () => "desktop-handoff-raw-code",
    createId: () => "desktop_handoff_1",
    authorizeTarget: vi.fn().mockResolvedValue(undefined),
  };
}

describe("desktop Web handoff", () => {
  it("stores only a hash and consumes an allowlisted code once", async () => {
    const repository = createMemoryRepository();
    const deps = dependencies(repository);

    const issued = await issueDesktopWebHandoff({
      userId: "user_1",
      sessionId: "desktop_session_1",
      targetPath: "/settings/companies",
    }, deps);

    expect(issued).toEqual({
      code: "desktop-handoff-raw-code",
      targetPath: "/settings/companies",
      expiresAt: new Date("2026-07-27T08:01:00.000Z"),
    });
    expect([...repository.records.values()][0]).toMatchObject({
      userId: "user_1",
      sessionId: "desktop_session_1",
      targetPath: "/settings/companies",
      codeHash: createHash("sha256").update("desktop-handoff-raw-code").digest("hex"),
    });
    expect(JSON.stringify([...repository.records.values()][0])).not.toContain(
      "desktop-handoff-raw-code",
    );

    await expect(consumeDesktopWebHandoff("desktop-handoff-raw-code", deps))
      .resolves.toMatchObject({
        userId: "user_1",
        userEmail: "owner@example.com",
        targetPath: "/settings/companies",
      });
    await expect(consumeDesktopWebHandoff("desktop-handoff-raw-code", deps))
      .rejects.toThrow("Desktop Web handoff has already been consumed");
  });

  it("rejects expired codes without consuming them", async () => {
    const repository = createMemoryRepository();
    const deps = dependencies(repository);
    const issued = await issueDesktopWebHandoff({
      userId: "user_1",
      sessionId: "desktop_session_1",
      targetPath: "/settings/devices",
    }, deps);

    await expect(consumeDesktopWebHandoff(issued.code, {
      ...deps,
      now: () => new Date("2026-07-27T08:01:00.000Z"),
    })).rejects.toThrow("Desktop Web handoff has expired");
    expect([...repository.records.values()][0]?.consumedAt).toBeNull();
  });

  it.each([
    "https://evil.example/settings",
    "/settings/companies?next=https://evil.example",
    "/settings/../admin",
    "/companies/company_1/unknown",
  ])("rejects a target outside the fixed allowlist: %s", async (targetPath) => {
    const repository = createMemoryRepository();

    await expect(issueDesktopWebHandoff({
      userId: "user_1",
      sessionId: "desktop_session_1",
      targetPath,
    }, dependencies(repository))).rejects.toThrow("Desktop Web handoff target is not allowed");
    expect(repository.records.size).toBe(0);
  });

  it("checks target authorization before creating a code", async () => {
    const repository = createMemoryRepository();
    const authorizeTarget = vi.fn().mockRejectedValue(
      new Error("Desktop Web handoff target access denied"),
    );

    await expect(issueDesktopWebHandoff({
      userId: "user_1",
      sessionId: "desktop_session_1",
      targetPath: "/companies/company_1/members",
    }, {
      ...dependencies(repository),
      authorizeTarget,
    })).rejects.toThrow("Desktop Web handoff target access denied");
    expect(repository.records.size).toBe(0);
  });
});
