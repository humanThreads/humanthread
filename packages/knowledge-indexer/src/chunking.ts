import { createHash } from "node:crypto";
import { KNOWLEDGE_CHUNKER_VERSION } from "@humanthread/shared";

export interface KnowledgeChunkInput {
  entryId: string;
  version: number;
  stableKey: string;
  title: string;
  entryType: string;
  summary: string;
  bodyMarkdown: string;
  tags: string[];
}

export interface KnowledgeChunk {
  id: string;
  entryId: string;
  version: number;
  stableKey: string;
  title: string;
  headingPath: string[];
  chunkIndex: number;
  content: string;
  contentDigest: string;
  entryType: string;
  tags: string[];
}

export const DEFAULT_CHUNK_TARGET = 700;
export const DEFAULT_CHUNK_OVERLAP = 100;
export const DEFAULT_CHUNK_MAX = 1_200;

export function chunkKnowledgeVersion(input: KnowledgeChunkInput): KnowledgeChunk[] {
  const source = [input.summary.trim(), input.bodyMarkdown.trim()].filter(Boolean).join("\n\n");
  if (!source) return [];
  const blocks = splitMarkdownBlocks(source);
  const units: Array<{ headingPath: string[]; content: string }> = [];
  let headingPath: string[] = [];
  for (const block of blocks) {
    const heading = block.match(/^(#{1,6})\s+(.+)$/u);
    if (heading) {
      const level = heading[1]!.length;
      const text = heading[2]!.trim();
      headingPath = [...headingPath.slice(0, level - 1), text];
      continue;
    }
    const segments = block.length <= DEFAULT_CHUNK_MAX
      ? [block]
      : splitLongBlock(block, DEFAULT_CHUNK_TARGET, DEFAULT_CHUNK_MAX);
    for (const segment of segments) {
      const content = segment.trim();
      if (content) units.push({ headingPath: [...headingPath], content });
    }
  }
  const merged = mergeUnits(units, DEFAULT_CHUNK_TARGET, DEFAULT_CHUNK_OVERLAP);
  return merged.map((unit, index) => ({
    id: createHash("md5").update([
      "knowledge-chunk",
      input.entryId,
      String(input.version),
      String(index),
      unit.content,
    ].join("\0")).digest("hex"),
    entryId: input.entryId,
    version: input.version,
    stableKey: input.stableKey,
    title: input.title,
    headingPath: unit.headingPath,
    chunkIndex: index,
    content: unit.content,
    contentDigest: createHash("md5").update(unit.content).digest("hex"),
    entryType: input.entryType,
    tags: [...input.tags],
  }));
}

function splitMarkdownBlocks(markdown: string): string[] {
  const lines = markdown.replace(/\r\n?/gu, "\n").split("\n");
  const blocks: string[] = [];
  let current: string[] = [];
  let fence: string | null = null;
  const flush = () => {
    const value = current.join("\n").trim();
    if (value) blocks.push(value);
    current = [];
  };
  for (const line of lines) {
    const fenceMatch = line.match(/^\s*(```|~~~)/u);
    if (fenceMatch) {
      const marker = fenceMatch[1]!;
      if (!fence) {
        flush();
        fence = marker;
      } else if (fence === marker) {
        current.push(line);
        flush();
        fence = null;
        continue;
      }
      current.push(line);
      continue;
    }
    if (!fence && (line.trim() === "" || /^#{1,6}\s+/u.test(line) || /^\s*(?:[-*+]|\d+[.)])\s+/u.test(line))) {
      flush();
      if (line.trim()) current.push(line);
      continue;
    }
    current.push(line);
    if (!fence && /^\s*\|.*\|\s*$/u.test(line)) {
      flush();
    }
  }
  flush();
  return blocks;
}

function splitLongBlock(block: string, target: number, max: number): string[] {
  if (block.startsWith("```") || block.startsWith("~~~")) {
    const lines = block.split("\n");
    const chunks: string[] = [];
    let current: string[] = [];
    for (const line of lines) {
      if (current.join("\n").length + line.length + 1 > max && current.length > 1) {
        chunks.push(current.join("\n"));
        current = [current[0] ?? ""];
      }
      current.push(line);
    }
    if (current.length > 0) chunks.push(current.join("\n"));
    return chunks;
  }
  const sentences = block.split(/(?<=[。！？!?；;])\s*|\n/gu).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > target) {
      chunks.push(current);
      current = current.slice(-DEFAULT_CHUNK_OVERLAP) + sentence;
    } else {
      current += sentence;
    }
    while (current.length > max) {
      chunks.push(current.slice(0, max));
      current = current.slice(max - DEFAULT_CHUNK_OVERLAP);
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

function mergeUnits(
  units: Array<{ headingPath: string[]; content: string }>,
  target: number,
  overlap: number,
): Array<{ headingPath: string[]; content: string }> {
  const result: Array<{ headingPath: string[]; content: string }> = [];
  let current: { headingPath: string[]; content: string } | null = null;
  for (const unit of units) {
    if (!current || current.headingPath.join("\0") !== unit.headingPath.join("\0")
      || current.content.length + unit.content.length + 2 > target * 1.35) {
      if (current) result.push(current);
      current = { headingPath: [...unit.headingPath], content: unit.content };
      continue;
    }
    const prefix = current.content.slice(-overlap);
    current.content = `${current.content}\n\n${prefix ? `${prefix}\n` : ""}${unit.content}`;
  }
  if (current) result.push(current);
  return result;
}
