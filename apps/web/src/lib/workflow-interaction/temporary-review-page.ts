import { createHash, randomBytes } from "node:crypto";

export const TEMPORARY_REVIEW_PAGE_MAX_BYTES = 512 * 1024;
export const TEMPORARY_REVIEW_PAGE_MAX_PER_INTERACTION = 4;
export const TEMPORARY_REVIEW_PAGE_TTL_MS = 72 * 60 * 60 * 1_000;

/**
 * A page an Agent wants a human to read while answering an interaction.
 *
 * These pages are deliberately *not* platform artifacts: they are never
 * written to the database, object storage or the artifact catalog, so they do
 * not inherit retention, scanning or download-policy obligations. They live in
 * this short-lived in-process proxy only, which keeps the security surface to
 * "an authenticated project reader can view this exact token once, until it
 * expires".
 */
export type TemporaryReviewPageReference = {
  token: string;
  fileName: string;
  byteSize: number;
  checksum: string;
};

type StoredPage = TemporaryReviewPageReference & {
  html: string;
  interactionId: string | null;
  expiresAt: number;
};

export type TemporaryReviewPageFailure =
  | "temporary_review_page_not_found"
  | "temporary_review_page_expired"
  | "temporary_review_page_invalid";

export class TemporaryReviewPageError extends Error {
  readonly code: TemporaryReviewPageFailure;

  constructor(code: TemporaryReviewPageFailure, message: string) {
    super(message);
    this.code = code;
  }
}

const PAGES = new Map<string, StoredPage>();
const TOKENS_BY_INTERACTION = new Map<string, Set<string>>();

function assertHtml(html: string): string {
  const trimmed = html.trim();
  if (!trimmed) {
    throw new TemporaryReviewPageError("temporary_review_page_invalid", "Review page content is empty");
  }
  if (Buffer.byteLength(trimmed, "utf8") > TEMPORARY_REVIEW_PAGE_MAX_BYTES) {
    throw new TemporaryReviewPageError("temporary_review_page_invalid", "Review page exceeds the size limit");
  }
  return trimmed;
}

function normalizeFileName(value: string): string {
  const fileName = value.trim().replace(/[\u0000-\u001f\u007f]/gu, "").slice(0, 191);
  // Only the leaf name is kept: a temporary page has no repository location,
  // so any path the Agent supplies must not leak into the download name.
  const leaf = fileName.split(/[\\/]/u).at(-1) ?? "";
  if (!leaf || leaf === "." || leaf === ".." || !/\.html?$/iu.test(leaf)) {
    throw new TemporaryReviewPageError(
      "temporary_review_page_invalid",
      "Review page file name must be an HTML file name",
    );
  }
  return leaf;
}

/**
 * Registers one page and returns the opaque reference the interaction carries.
 * The page is bound to an interaction later, once that interaction exists.
 */
export function registerTemporaryReviewPage(input: {
  fileName: string;
  html: string;
  now?: Date;
}): TemporaryReviewPageReference {
  const html = assertHtml(input.html);
  const fileName = normalizeFileName(input.fileName);
  const now = input.now ?? new Date();
  const token = randomBytes(16).toString("hex");
  const checksum = createHash("sha256").update(html, "utf8").digest("hex");
  PAGES.set(token, {
    token,
    fileName,
    byteSize: Buffer.byteLength(html, "utf8"),
    checksum,
    html,
    interactionId: null,
    expiresAt: now.getTime() + TEMPORARY_REVIEW_PAGE_TTL_MS,
  });
  return { token, fileName, byteSize: Buffer.byteLength(html, "utf8"), checksum };
}

/**
 * Binds freshly registered pages to the interaction that will reference them.
 * Unbound pages are never readable, so an Agent cannot register a page and
 * then reference the token from somewhere the human was not asked to look.
 */
export function bindTemporaryReviewPages(input: {
  interactionId: string;
  tokens: readonly string[];
}): void {
  const bound = TOKENS_BY_INTERACTION.get(input.interactionId) ?? new Set<string>();
  for (const token of input.tokens) {
    const page = PAGES.get(token);
    if (!page) continue;
    page.interactionId = input.interactionId;
    bound.add(token);
  }
  if (bound.size > 0) TOKENS_BY_INTERACTION.set(input.interactionId, bound);
}

export function readTemporaryReviewPage(input: {
  token: string;
  interactionId: string;
  now?: Date;
}): { html: string; fileName: string; byteSize: number; checksum: string } {
  const now = input.now ?? new Date();
  const page = PAGES.get(input.token);
  // A page bound to a different interaction is reported as missing so the
  // response cannot be used to probe which tokens exist.
  if (!page || page.interactionId !== input.interactionId) {
    throw new TemporaryReviewPageError("temporary_review_page_not_found", "Review page not found");
  }
  if (page.expiresAt <= now.getTime()) {
    PAGES.delete(input.token);
    TOKENS_BY_INTERACTION.get(input.interactionId)?.delete(input.token);
    throw new TemporaryReviewPageError("temporary_review_page_expired", "Review page has expired");
  }
  return {
    html: page.html,
    fileName: page.fileName,
    byteSize: page.byteSize,
    checksum: page.checksum,
  };
}

/** Test seam: the proxy is process-local by design, so tests need a reset. */
export function resetTemporaryReviewPages(): void {
  PAGES.clear();
  TOKENS_BY_INTERACTION.clear();
}
