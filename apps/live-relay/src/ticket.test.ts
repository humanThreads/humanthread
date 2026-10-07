import { createHmac, randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { verifyTicket } from "./server";
// The control plane signs tickets; the relay verifies them. Both sides own an
// independent implementation, so a cross-package test guards the wire format.
import { createLiveSessionTicket } from "../../web/src/lib/live-session/live-session-ticket";

const secret = "relay-ticket-secret-for-tests";
const sessionId = "a".repeat(32);
const now = new Date("2026-09-24T10:00:00.000Z");

function signedTicket(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `lst1.${encoded}.${createHmac("sha256", secret).update(encoded).digest("base64url")}`;
}

function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    jti: randomUUID().replaceAll("-", ""),
    sessionId,
    kind: "control",
    iat: Math.floor(now.getTime() / 1000),
    exp: Math.floor(now.getTime() / 1000) + 60,
    ...overrides,
  };
}

describe("relay ticket verification", () => {
  it("accepts a control-plane issued ticket without sharing an implementation", () => {
    const issued = createLiveSessionTicket({ sessionId, kind: "execution", now, secret });

    expect(verifyTicket({
      ticket: issued.token,
      kind: "execution",
      sessionId,
      secret,
      now,
    })).toBe(true);
    expect(verifyTicket({
      ticket: issued.token,
      kind: "control",
      sessionId,
      secret,
      now,
    })).toBe(false);
  });

  it("accepts a signed ticket scoped to the requested session and kind", () => {
    expect(verifyTicket({
      ticket: signedTicket(validPayload()),
      kind: "control",
      sessionId,
      secret,
      now,
    })).toBe(true);
  });

  it("rejects malformed or unsigned ticket material without throwing", () => {
    for (const ticket of [
      "",
      "lst1",
      "lst1..",
      "lst1.not-base64.zzz",
      "lst1.bm90LWpzb24.signature",
      `lst1.${Buffer.from("[]").toString("base64url")}.sig`,
      "v1.aaaa.bbbb",
    ]) {
      expect(() => verifyTicket({ ticket, kind: "control", sessionId, secret, now })).not.toThrow();
      expect(verifyTicket({ ticket, kind: "control", sessionId, secret, now })).toBe(false);
    }
  });

  it("rejects a ticket signed for another session, kind, or expiry", () => {
    expect(verifyTicket({
      ticket: signedTicket(validPayload({ sessionId: "b".repeat(32) })),
      kind: "control",
      sessionId,
      secret,
      now,
    })).toBe(false);
    expect(verifyTicket({
      ticket: signedTicket(validPayload({ kind: "execution" })),
      kind: "control",
      sessionId,
      secret,
      now,
    })).toBe(false);
    expect(verifyTicket({
      ticket: signedTicket(validPayload({ exp: Math.floor(now.getTime() / 1000) - 1 })),
      kind: "control",
      sessionId,
      secret,
      now,
    })).toBe(false);
  });

  it("rejects a tampered payload that keeps a valid signature shape", () => {
    const ticket = signedTicket(validPayload());
    const [prefix, encoded, signature] = ticket.split(".");
    const tampered = Buffer.from(JSON.stringify(validPayload({ kind: "execution" }))).toString("base64url");
    expect(verifyTicket({
      ticket: `${prefix}.${tampered}.${signature}`,
      kind: "execution",
      sessionId,
      secret,
      now,
    })).toBe(false);
    expect(encoded).toBeTruthy();
  });
});
