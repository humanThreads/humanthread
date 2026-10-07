export interface KnowledgeSparseVector {
  indices: number[];
  values: number[];
}

export function buildKnowledgeSparseVector(text: string): KnowledgeSparseVector {
  const terms = tokenize(text);
  const counts = new Map<string, number>();
  for (const term of terms) counts.set(term, (counts.get(term) ?? 0) + 1);
  const entries = Array.from(counts.entries()).sort(([left], [right]) => hashTerm(left) - hashTerm(right) || left.localeCompare(right));
  const maxCount = entries.reduce((max, [, count]) => Math.max(max, count), 0);
  const indices = entries.map(([term]) => hashTerm(term));
  const values = entries.map(([, count]) => Number((1 + Math.log(count)) / (1 + Math.log(maxCount || 1))));
  return { indices, values };
}

export function tokenizeKnowledgeText(text: string): string[] {
  const normalized = text.normalize("NFKC").toLowerCase();
  const tokens: string[] = [];
  for (const match of normalized.matchAll(/[\p{Script=Han}]+|[a-z0-9]+(?:[._-][a-z0-9]+)*/gu)) {
    const value = match[0]!;
    if (/^[\p{Script=Han}]+$/u.test(value)) {
      const chars = Array.from(value);
      for (let index = 0; index < chars.length; index += 1) {
        tokens.push(chars[index]!);
        if (index + 1 < chars.length) tokens.push(chars.slice(index, index + 2).join(""));
        if (index + 2 < chars.length) tokens.push(chars.slice(index, index + 3).join(""));
      }
    } else {
      tokens.push(value);
    }
  }
  return tokens;
}

function tokenize(text: string): string[] {
  return tokenizeKnowledgeText(text);
}

function hashTerm(term: string): number {
  let hash = 2166136261;
  for (const character of term) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
