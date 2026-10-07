import { mkdir, open, readFile, readdir, rm, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

const SESSION_ID_PATTERN = /^[a-f0-9]{32}$/u;
const DEFAULT_RETENTION_DAYS = 30;
const MAX_RETENTION_DAYS = 3_650;

export type JournalStatus = "ready" | "degraded" | "replay_unavailable";

export interface JournalChunk {
  sequence: number;
  bytes: Uint8Array;
}

export interface JournalState {
  status: JournalStatus;
  retentionDays: number;
  firstSequence: number;
  lastSequence: number;
  bytes: number;
}

interface JournalLine {
  sequence?: unknown;
  dataBase64?: unknown;
}

function journalError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function validateSessionId(sessionId: string): string {
  if (!SESSION_ID_PATTERN.test(sessionId)) throw journalError("live_session_invalid", "Live session id is invalid");
  return sessionId;
}

function validateRetentionDays(value: number | undefined): number {
  const days = value ?? DEFAULT_RETENTION_DAYS;
  if (!Number.isInteger(days) || days < 1 || days > MAX_RETENTION_DAYS) {
    throw journalError("live_session_invalid", "Journal retention must be between 1 and 3650 days");
  }
  return days;
}

function decodeLine(line: string): { sequence: number; bytes: Uint8Array } | null {
  if (!line.trim()) return null;
  let parsed: JournalLine;
  try {
    parsed = JSON.parse(line) as JournalLine;
  } catch {
    return null;
  }
  if (
    !Number.isSafeInteger(parsed.sequence)
    || Number(parsed.sequence) < 1
    || typeof parsed.dataBase64 !== "string"
  ) return null;
  const bytes = Buffer.from(parsed.dataBase64, "base64");
  if (bytes.toString("base64").replace(/=+$/u, "") !== parsed.dataBase64.replace(/=+$/u, "")) return null;
  return { sequence: Number(parsed.sequence), bytes };
}

export class LiveSessionJournal {
  readonly #rootDirectory: string;
  readonly #retentionDays: number;
  readonly #locks = new Map<string, Promise<void>>();

  constructor(input: { rootDirectory: string; retentionDays?: number }) {
    if (!isAbsolute(input.rootDirectory) || /[\u0000-\u001F\u007F]/u.test(input.rootDirectory)) {
      throw journalError("live_session_invalid", "Journal root directory must be absolute");
    }
    this.#rootDirectory = input.rootDirectory;
    this.#retentionDays = validateRetentionDays(input.retentionDays);
  }

  sessionDirectory(sessionId: string): string {
    return join(this.#rootDirectory, validateSessionId(sessionId));
  }

  async append(sessionId: string, bytes: Uint8Array): Promise<JournalState> {
    validateSessionId(sessionId);
    if (bytes.byteLength === 0) return this.state(sessionId);
    return this.#withLock(sessionId, async () => {
      const directory = this.sessionDirectory(sessionId);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const current = await this.read(sessionId);
      const sequence = current.lastSequence + 1;
      const line = `${JSON.stringify({ sequence, dataBase64: Buffer.from(bytes).toString("base64") })}\n`;
      const handle = await open(join(directory, "journal.ndjson"), "a", 0o600);
      try {
        await handle.write(line, undefined, "utf8");
      } finally {
        await handle.close();
      }
      return {
        ...current,
        status: current.status === "replay_unavailable" ? "degraded" : current.status,
        firstSequence: current.firstSequence === 0 ? sequence : current.firstSequence,
        lastSequence: sequence,
        bytes: current.bytes + bytes.byteLength,
      };
    });
  }

  async read(sessionId: string, afterSequence = 0): Promise<{ chunks: JournalChunk[]; bytes: number } & JournalState> {
    validateSessionId(sessionId);
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
      throw journalError("live_session_invalid", "Journal cursor is invalid");
    }
    let content: string;
    try {
      content = await readFile(join(this.sessionDirectory(sessionId), "journal.ndjson"), "utf8");
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return {
          status: "ready",
          retentionDays: this.#retentionDays,
          firstSequence: 0,
          lastSequence: 0,
          bytes: 0,
          chunks: [],
        };
      }
      throw error;
    }
    const chunks: JournalChunk[] = [];
    let malformed = 0;
    for (const line of content.split("\n")) {
      const decoded = decodeLine(line);
      if (!decoded) {
        if (line.trim()) malformed += 1;
        continue;
      }
      if (decoded.sequence > afterSequence) chunks.push(decoded);
    }
    const ordered = chunks.every((chunk, index) => index === 0 || chunk.sequence === chunks[index - 1]!.sequence + 1);
    const gap = chunks.some((chunk, index) => {
      if (index === 0) return afterSequence > 0 && chunk.sequence !== afterSequence + 1;
      return chunk.sequence !== chunks[index - 1]!.sequence + 1;
    });
    const status: JournalStatus = gap || malformed > 1 ? "replay_unavailable" : malformed === 1 ? "degraded" : "ready";
    const sequences = chunks.map((chunk) => chunk.sequence);
    return {
      status,
      retentionDays: this.#retentionDays,
      firstSequence: sequences[0] ?? 0,
      lastSequence: sequences.at(-1) ?? 0,
      bytes: chunks.reduce((sum, chunk) => sum + chunk.bytes.byteLength, 0),
      chunks: ordered ? chunks : [],
    };
  }

  async state(sessionId: string): Promise<JournalState> {
    const result = await this.read(sessionId);
    return {
      status: result.status,
      retentionDays: result.retentionDays,
      firstSequence: result.firstSequence,
      lastSequence: result.lastSequence,
      bytes: result.bytes,
    };
  }

  async remove(sessionId: string): Promise<void> {
    validateSessionId(sessionId);
    await rm(this.sessionDirectory(sessionId), { recursive: true, force: true });
    this.#locks.delete(sessionId);
  }

  async cleanup(input: { activeSessionIds: ReadonlySet<string>; now?: Date }): Promise<string[]> {
    const now = input.now ?? new Date();
    const cutoff = now.getTime() - this.#retentionDays * 24 * 60 * 60 * 1_000;
    let entries;
    try {
      entries = await readdir(this.#rootDirectory, { withFileTypes: true });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
      throw error;
    }
    const removed: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !SESSION_ID_PATTERN.test(entry.name) || input.activeSessionIds.has(entry.name)) continue;
      const info = await stat(join(this.#rootDirectory, entry.name));
      if (info.mtimeMs >= cutoff) continue;
      await this.remove(entry.name);
      removed.push(entry.name);
    }
    return removed;
  }

  async #withLock<T>(sessionId: string, action: () => Promise<T>): Promise<T> {
    const previous = this.#locks.get(sessionId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    this.#locks.set(sessionId, previous.then(() => gate));
    await previous;
    try {
      return await action();
    } finally {
      release();
      if (this.#locks.get(sessionId) === gate) this.#locks.delete(sessionId);
    }
  }
}
