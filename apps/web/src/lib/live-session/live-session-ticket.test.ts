import { describe, expect, it } from "vitest";

import {
  consumeLiveSessionTicket,
  createLiveSessionTicket,
  verifyLiveSessionTicket,
} from "./live-session-ticket";

const secret = "live-session-ticket-secret-for-tests";
const sessionId = "a".repeat(32);
const now = new Date("2026-09-24T10:00:00.000Z");

describe("LiveSession relay tickets", () => {
  it("issues a viewer ticket that is not accepted as execution", () => {
    const ticket = createLiveSessionTicket({ sessionId, kind: "viewer", now, secret });

    expect(verifyLiveSessionTicket({ ticket: ticket.token, now, secret })).toMatchObject({
      sessionId,
      kind: "viewer",
    });
    expect(() => verifyLiveSessionTicket({
      ticket: ticket.token,
      now,
      secret,
      expectedKind: "execution",
    })).toThrow("Live session ticket kind is invalid");
  });

  it("issues a short-lived ticket scoped to one session and connection kind", () => {
    const ticket = createLiveSessionTicket({
      sessionId,
      kind: "execution",
      now,
      secret,
    });

    expect(ticket.expiresAt).toEqual(new Date("2026-09-24T10:01:00.000Z"));
    expect(verifyLiveSessionTicket({ ticket: ticket.token, now, secret })).toMatchObject({
      sessionId,
      kind: "execution",
      expiresAt: ticket.expiresAt,
    });
  });

  it("rejects a ticket issued for the other relay kind", () => {
    const ticket = createLiveSessionTicket({ sessionId, kind: "control", now, secret });

    expect(() => verifyLiveSessionTicket({
      ticket: ticket.token,
      now,
      secret,
      expectedKind: "execution",
    })).toThrow("Live session ticket kind is invalid");
  });

  it("consumes each ticket exactly once", async () => {
    const ticket = createLiveSessionTicket({ sessionId, kind: "control", now, secret });
    const consumed = new Set<string>();

    await expect(consumeLiveSessionTicket({
      ticket: ticket.token,
      now,
      secret,
      expectedKind: "control",
      consume: async (ticketId) => consumed.has(ticketId) ? false : (consumed.add(ticketId), true),
    })).resolves.toMatchObject({ sessionId, kind: "control" });
    await expect(consumeLiveSessionTicket({
      ticket: ticket.token,
      now,
      secret,
      expectedKind: "control",
      consume: async (ticketId) => consumed.has(ticketId) ? false : (consumed.add(ticketId), true),
    })).rejects.toThrow("Live session ticket has already been used");
  });
});
