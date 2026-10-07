export interface KnowledgeRedactionResult {
  status: "clean" | "sensitive_content_detected";
  redactionCount: number;
}

export interface KnowledgeTextScanResult {
  safeContent: string;
  redactionResult: KnowledgeRedactionResult;
}

export interface KnowledgeValueScanResult<T> {
  safeValue: T;
  redactionResult: KnowledgeRedactionResult;
}

export function scanKnowledgeSensitiveText(content: string): KnowledgeTextScanResult {
  if (typeof content !== "string") throw new TypeError("Knowledge content must be a string");

  let redactionCount = 0;
  const replace = (value: string, pattern: RegExp) => value.replace(pattern, () => {
    redactionCount += 1;
    return "[REDACTED]";
  });

  let safeContent = content;
  safeContent = replace(safeContent, /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/giu);
  safeContent = replace(safeContent, /\b(?:ghp|github_pat)_[A-Za-z0-9_]{8,}\b/gu);
  safeContent = safeContent.replace(
    /\b((?:api[_-]?key|password|secret|token)\s*[=:]\s*)([^\s,;]+)/giu,
    (_match, prefix: string) => {
      redactionCount += 1;
      return `${prefix}[REDACTED]`;
    },
  );
  safeContent = replace(safeContent, /\bsk-[A-Za-z0-9_-]{8,}\b/gu);
  safeContent = replace(safeContent, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu);
  safeContent = replace(safeContent, /(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/gu);

  return {
    safeContent,
    redactionResult: {
      status: redactionCount > 0 ? "sensitive_content_detected" : "clean",
      redactionCount,
    },
  };
}

export function scanKnowledgeSensitiveValue<T>(value: T): KnowledgeValueScanResult<T> {
  let redactionCount = 0;

  const visit = (current: unknown): unknown => {
    if (typeof current === "string") {
      const scanned = scanKnowledgeSensitiveText(current);
      redactionCount += scanned.redactionResult.redactionCount;
      return scanned.safeContent;
    }
    if (current instanceof Date) return new Date(current);
    if (Array.isArray(current)) return current.map(visit);
    if (current && typeof current === "object") {
      return Object.fromEntries(
        Object.entries(current).map(([key, child]) => [key, visit(child)]),
      );
    }
    return current;
  };

  return {
    safeValue: visit(value) as T,
    redactionResult: {
      status: redactionCount > 0 ? "sensitive_content_detected" : "clean",
      redactionCount,
    },
  };
}
