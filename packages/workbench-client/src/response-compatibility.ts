import type { ZodType } from "zod";

const MAX_COMPATIBILITY_PASSES = 16;

export function parseForwardCompatibleResponse<T>(
  schema: ZodType<T>,
  value: unknown,
): T {
  const candidate = cloneResponseValue(value);

  for (let pass = 0; pass < MAX_COMPATIBILITY_PASSES; pass += 1) {
    const parsed = schema.safeParse(candidate);
    if (parsed.success) return parsed.data;

    let removedUnknownKey = false;
    for (const issue of parsed.error.issues) {
      if (issue.code !== "unrecognized_keys") continue;
      const target = valueAtPath(candidate, issue.path);
      if (!isRecord(target)) continue;
      for (const key of issue.keys) {
        if (!Object.prototype.hasOwnProperty.call(target, key)) continue;
        delete target[key];
        removedUnknownKey = true;
      }
    }

    if (!removedUnknownKey) throw parsed.error;
  }

  return schema.parse(candidate);
}

function cloneResponseValue(
  value: unknown,
  seen: WeakMap<object, unknown> = new WeakMap(),
): unknown {
  if (Array.isArray(value)) {
    const existing = seen.get(value);
    if (existing) return existing;
    const clone: unknown[] = [];
    seen.set(value, clone);
    for (const item of value) clone.push(cloneResponseValue(item, seen));
    return clone;
  }
  if (!isRecord(value)) return value;
  const existing = seen.get(value);
  if (existing) return existing;
  const clone: Record<string, unknown> = {};
  seen.set(value, clone);
  for (const [key, child] of Object.entries(value)) {
    clone[key] = cloneResponseValue(child, seen);
  }
  return clone;
}

function valueAtPath(root: unknown, path: PropertyKey[]): unknown {
  let current = root;
  for (const segment of path) {
    if (typeof segment === "number") {
      if (!Array.isArray(current)) return undefined;
      current = current[segment];
      continue;
    }
    if (typeof segment !== "string" || !isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
