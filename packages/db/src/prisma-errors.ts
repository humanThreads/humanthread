const RECOVERABLE_ERROR_CODES = new Set([
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "ETIMEDOUT",
  "PROTOCOL_CONNECTION_LOST",
  "P1001",
  "P1002",
  "P1008",
  "P1017",
  "P2024",
]);

const RECOVERABLE_MARIADB_ERROR_NUMBERS = new Set([
  45009, // ER_SOCKET_UNEXPECTED_CLOSE
  45012, // ER_CONNECTION_TIMEOUT
  45019, // ER_SOCKET
  45026, // ER_SOCKET_TIMEOUT
  45027, // ER_POOL_ALREADY_CLOSED
  45028, // ER_GET_CONNECTION_TIMEOUT
  45035, // ER_ADD_CONNECTION_CLOSED_POOL
  45039, // ER_INITIAL_TIMEOUT_ERROR
  45042, // ER_PING_TIMEOUT
  45060, // ER_POOL_NOT_INITIALIZED
  45061, // ER_POOL_NO_CONNECTION
]);

const NESTED_ERROR_KEYS = [
  "cause",
  "meta",
  "driverAdapterError",
  "originalError",
] as const;
const MAX_ERROR_DEPTH = 6;
const RECOVERABLE_POOL_TIMEOUT_MESSAGE =
  "pool timeout: failed to retrieve a connection from pool";

function readProperty(value: object, property: string): unknown {
  try {
    return Reflect.get(value, property);
  } catch {
    return undefined;
  }
}

export function isPrismaUniqueConstraintError(error: unknown): boolean {
  return (
    ((typeof error === "object" || typeof error === "function") && error !== null) &&
    readProperty(error, "code") === "P2002"
  );
}

function inspectRecoverableError(
  value: unknown,
  visited: Set<object>,
  depth: number,
): boolean {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return false;
  }

  if (depth > MAX_ERROR_DEPTH || visited.has(value)) {
    return false;
  }

  visited.add(value);

  const code = readProperty(value, "code");
  if (typeof code === "string" && RECOVERABLE_ERROR_CODES.has(code.toUpperCase())) {
    return true;
  }

  const errno = readProperty(value, "errno");
  const originalCode = readProperty(value, "originalCode");
  const mariaDbErrorNumbers = [errno, code, originalCode]
    .map((candidate) => {
      if (typeof candidate === "number") {
        return candidate;
      }

      if (typeof candidate === "string" && /^\d+$/u.test(candidate)) {
        return Number(candidate);
      }

      return undefined;
    })
    .filter((candidate): candidate is number => candidate !== undefined);
  if (
    mariaDbErrorNumbers.some((candidate) =>
      RECOVERABLE_MARIADB_ERROR_NUMBERS.has(candidate),
    )
  ) {
    return true;
  }

  const message = readProperty(value, "message");
  const originalMessage = readProperty(value, "originalMessage");
  if (
    [message, originalMessage].some(
      (candidate) =>
        typeof candidate === "string" &&
        candidate.toLowerCase().includes(RECOVERABLE_POOL_TIMEOUT_MESSAGE),
    )
  ) {
    return true;
  }

  return NESTED_ERROR_KEYS.some((key) =>
    inspectRecoverableError(readProperty(value, key), visited, depth + 1),
  );
}

export function isRecoverableDatabaseConnectionError(error: unknown): boolean {
  return inspectRecoverableError(error, new Set<object>(), 0);
}
