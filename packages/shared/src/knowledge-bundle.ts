import { createHash } from "node:crypto";

export const ARCHITECTURE_BUNDLE_ENTRY_FILE = "index.htm";
export const ARCHITECTURE_BUNDLE_MAX_BYTES = 1_000_000;

export interface ValidatedArchitectureBundle {
  fileName: typeof ARCHITECTURE_BUNDLE_ENTRY_FILE;
  content: string;
  contentDigest: string;
  byteSize: number;
}

const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /<script[^>]*\bsrc\s*=/iu, message: "Architecture bundle may not load remote scripts" },
  { pattern: /<link[^>]*\bhref\s*=\s*["']?(?:https?:)?\/\//iu, message: "Architecture bundle may not load remote styles" },
  { pattern: /<(?:img|video|audio|source|track|embed|object|iframe)[^>]*\b(?:src|data)\s*=\s*["']?(?:https?:)?\/\//iu, message: "Architecture bundle may not load remote media" },
  { pattern: /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/u, message: "Architecture bundle may not use network APIs" },
  { pattern: /@import\s+(?:url\()?["']?(?:https?:)?\/\//iu, message: "Architecture bundle may not import remote stylesheets" },
  { pattern: /<base\b/iu, message: "Architecture bundle may not declare a base URL" },
  { pattern: /\b(?:window|document)\.(?:top|parent|opener)\s*\.\s*(?:location|open)\b/u, message: "Architecture bundle may not navigate the host page" },
];

export function validateArchitectureBundle(input: { fileName: string; content: string }): ValidatedArchitectureBundle {
  if (input.fileName !== ARCHITECTURE_BUNDLE_ENTRY_FILE) {
    throw validationError(`Architecture bundle entry file must be ${ARCHITECTURE_BUNDLE_ENTRY_FILE}`);
  }
  if (typeof input.content !== "string" || input.content.trim().length === 0) {
    throw validationError("Architecture bundle content is required");
  }
  const byteSize = Buffer.byteLength(input.content, "utf8");
  if (byteSize > ARCHITECTURE_BUNDLE_MAX_BYTES) {
    throw validationError("Architecture bundle exceeds the maximum size");
  }
  for (const rule of FORBIDDEN_PATTERNS) {
    if (rule.pattern.test(input.content)) throw validationError(rule.message);
  }
  return {
    fileName: ARCHITECTURE_BUNDLE_ENTRY_FILE,
    content: input.content,
    contentDigest: createHash("md5").update(input.content, "utf8").digest("hex"),
    byteSize,
  };
}

function validationError(message: string): Error {
  return Object.assign(new Error(message), { code: "validation_failed" });
}
