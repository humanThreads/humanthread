import { beforeEach, describe, expect, it } from "vitest";

import {
  bindTemporaryReviewPages,
  readTemporaryReviewPage,
  registerTemporaryReviewPage,
  resetTemporaryReviewPages,
  TEMPORARY_REVIEW_PAGE_MAX_BYTES,
} from "./temporary-review-page";

const now = new Date("2026-10-05T04:00:00.000Z");

describe("temporary review page proxy", () => {
  beforeEach(() => {
    resetTemporaryReviewPages();
  });

  it("serves a registered page back to its own interaction", () => {
    const reference = registerTemporaryReviewPage({
      fileName: "generated/reviews/TASK-1001-chapter-plan.html",
      html: "<!doctype html><title>plan</title>",
      now,
    });
    bindTemporaryReviewPages({ interactionId: "interaction_1", tokens: [reference.token] });

    // Only the leaf name survives: the page has no repository location, so a
    // path must not leak into the download name.
    expect(reference.fileName).toBe("TASK-1001-chapter-plan.html");
    expect(reference.byteSize).toBe(Buffer.byteLength("<!doctype html><title>plan</title>", "utf8"));
    expect(readTemporaryReviewPage({
      token: reference.token,
      interactionId: "interaction_1",
      now,
    })).toMatchObject({
      html: "<!doctype html><title>plan</title>",
      fileName: "TASK-1001-chapter-plan.html",
    });
  });

  it("refuses a page that was never bound to an interaction", () => {
    const reference = registerTemporaryReviewPage({
      fileName: "plan.html",
      html: "<p>plan</p>",
      now,
    });

    expect(() => readTemporaryReviewPage({
      token: reference.token,
      interactionId: "interaction_1",
      now,
    })).toThrow(expect.objectContaining({ code: "temporary_review_page_not_found" }));
  });

  it("treats another interaction's page as missing so tokens cannot be probed", () => {
    const reference = registerTemporaryReviewPage({
      fileName: "plan.html",
      html: "<p>plan</p>",
      now,
    });
    bindTemporaryReviewPages({ interactionId: "interaction_1", tokens: [reference.token] });

    expect(() => readTemporaryReviewPage({
      token: reference.token,
      interactionId: "interaction_2",
      now,
    })).toThrow(expect.objectContaining({ code: "temporary_review_page_not_found" }));
  });

  it("stops serving a page once its TTL has passed", () => {
    const reference = registerTemporaryReviewPage({
      fileName: "plan.html",
      html: "<p>plan</p>",
      now,
    });
    bindTemporaryReviewPages({ interactionId: "interaction_1", tokens: [reference.token] });

    const later = new Date(now.getTime() + 73 * 60 * 60 * 1_000);
    expect(() => readTemporaryReviewPage({
      token: reference.token,
      interactionId: "interaction_1",
      now: later,
    })).toThrow(expect.objectContaining({ code: "temporary_review_page_expired" }));
    // The expired page is dropped rather than retained for a later retry.
    expect(() => readTemporaryReviewPage({
      token: reference.token,
      interactionId: "interaction_1",
      now: later,
    })).toThrow(expect.objectContaining({ code: "temporary_review_page_not_found" }));
  });

  it("rejects non-HTML names and oversized pages", () => {
    expect(() => registerTemporaryReviewPage({ fileName: "plan.txt", html: "<p>plan</p>", now }))
      .toThrow(expect.objectContaining({ code: "temporary_review_page_invalid" }));
    expect(() => registerTemporaryReviewPage({ fileName: "plan.html", html: "   ", now }))
      .toThrow(expect.objectContaining({ code: "temporary_review_page_invalid" }));
    expect(() => registerTemporaryReviewPage({
      fileName: "plan.html",
      html: "a".repeat(TEMPORARY_REVIEW_PAGE_MAX_BYTES + 1),
      now,
    })).toThrow(expect.objectContaining({ code: "temporary_review_page_invalid" }));
  });
});
