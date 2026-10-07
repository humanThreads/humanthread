import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export type WorkerOutboxRecord = {
  id: string;
  type: string;
  payload: unknown;
  createdAt: string;
};

type WorkerOutboxOptions = {
  directory: string;
  maxRecords: number;
  maxBytes: number;
  maxAgeMs?: number;
  now?: () => Date;
};

function outboxError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function redactedText(value: string, secrets: readonly string[]): string {
  const withKnownSecrets = secrets
    .filter((secret) => secret.length > 0)
    .reduce((current, secret) => current.split(secret).join("[redacted]"), value);
  return withKnownSecrets
    .replace(/\bBearer\s+[^\s]+/giu, "Bearer [redacted]")
    .replace(/\b(?:sk|htwp|htwps)_[A-Za-z0-9._-]+/gu, "[redacted]");
}

function isSensitiveKey(key: string): boolean {
  return /(api[_-]?key|authorization|token|secret|password|cookie|credential|openai)/iu.test(key);
}

export function redactWorkerPayload(value: unknown, key = "", depth = 0, secrets: readonly string[] = []): unknown {
  if (depth > 12) return "[truncated]";
  if (isSensitiveKey(key)) return "[redacted]";
  if (typeof value === "string") return redactedText(value, secrets);
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item) => redactWorkerPayload(item, "", depth + 1, secrets));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      redactWorkerPayload(entryValue, entryKey, depth + 1, secrets),
    ]));
  }
  return "[unsupported]";
}

export function createWorkerOutbox(options: WorkerOutboxOptions) {
  if (!Number.isInteger(options.maxRecords) || options.maxRecords < 1) {
    throw outboxError("worker_outbox_invalid", "Worker outbox maxRecords must be positive");
  }
  if (!Number.isInteger(options.maxBytes) || options.maxBytes < 1024) {
    throw outboxError("worker_outbox_invalid", "Worker outbox maxBytes must be at least 1024");
  }
  const maxAgeMs = options.maxAgeMs ?? 7 * 24 * 60 * 60 * 1_000;
  if (!Number.isInteger(maxAgeMs) || maxAgeMs < 1_000) {
    throw outboxError("worker_outbox_invalid", "Worker outbox maxAgeMs must be at least one second");
  }
  const now = options.now ?? (() => new Date());
  const path = join(options.directory, "outbox.json");
  let operations = Promise.resolve();

  const load = async (): Promise<WorkerOutboxRecord[]> => {
    try {
      const raw = await readFile(path, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw outboxError("worker_outbox_corrupt", "Worker outbox is invalid");
      return parsed.filter((record): record is WorkerOutboxRecord => (
        Boolean(record)
        && typeof record === "object"
        && typeof Reflect.get(record, "id") === "string"
        && typeof Reflect.get(record, "type") === "string"
        && typeof Reflect.get(record, "createdAt") === "string"
        && Date.parse(String(Reflect.get(record, "createdAt"))) >= now().getTime() - maxAgeMs
      ));
    } catch (error) {
      if (error && typeof error === "object" && Reflect.get(error, "code") === "ENOENT") return [];
      throw error;
    }
  };

  const persist = async (records: WorkerOutboxRecord[]): Promise<void> => {
    const content = JSON.stringify(records);
    if (Buffer.byteLength(content, "utf8") > options.maxBytes) {
      throw outboxError("worker_outbox_full", "Worker outbox exceeds its byte limit");
    }
    await mkdir(options.directory, { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, path);
  };

  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = operations.then(operation, operation);
    operations = result.then(() => undefined, () => undefined);
    return result;
  };

  return {
    enqueue(input: { type: string; payload: unknown }): Promise<void> {
      return serialize(async () => {
        if (!input.type.trim() || input.type.length > 128) {
          throw outboxError("worker_outbox_invalid", "Worker outbox event type is invalid");
        }
        const record: WorkerOutboxRecord = {
          id: randomUUID(),
          type: input.type,
          payload: redactWorkerPayload(input.payload),
          createdAt: now().toISOString(),
        };
        if (Buffer.byteLength(JSON.stringify(record), "utf8") > options.maxBytes) {
          throw outboxError("worker_outbox_record_too_large", "Worker outbox event exceeds its byte limit");
        }
        const records = [...await load(), record];
        while (records.length > options.maxRecords || Buffer.byteLength(JSON.stringify(records), "utf8") > options.maxBytes) {
          records.shift();
        }
        await persist(records);
      });
    },
    read(): Promise<WorkerOutboxRecord[]> {
      return serialize(async () => {
        const records = await load();
        await persist(records);
        return records;
      });
    },
    acknowledge(recordIds: readonly string[]): Promise<void> {
      return serialize(async () => {
        const acknowledged = new Set(recordIds);
        await persist((await load()).filter((record) => !acknowledged.has(record.id)));
      });
    },
  };
}
