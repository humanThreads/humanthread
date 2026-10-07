import { createHash } from "node:crypto";

export const TASK_FIELD_TYPES = ["text", "number", "date", "boolean", "select", "user"] as const;
export type TaskFieldType = (typeof TASK_FIELD_TYPES)[number];

export interface TaskFieldDefinitionRecord {
  id: string;
  projectId: string;
  key: string;
  name: string;
  type: string;
  required: boolean;
  options: unknown;
  sortOrder: number;
  isActive: boolean;
}

export interface NormalizedTaskFieldValue {
  id: string;
  fieldDefinitionId: string;
  key: string;
  name: string;
  type: TaskFieldType;
  value: unknown;
}

export function validateProjectShortCode(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,12}$/u.test(normalized)) {
    throw Object.assign(new Error("Project short code must be 2-12 uppercase letters or numbers"), {
      code: "validation_failed",
    });
  }
  return normalized;
}

export function deriveProjectShortCode(name: string): string {
  const letters = name.toUpperCase().replace(/[^A-Z0-9]/gu, "").slice(0, 8);
  if (letters.length >= 2) return letters;
  const digest = createHash("sha256").update(name).digest("hex").slice(0, 6).toUpperCase();
  return `P${digest}`;
}

export function validateTaskFieldKey(value: string): string {
  const normalized = value.trim();
  if (!/^[a-z][a-z0-9_]{1,63}$/u.test(normalized)) {
    throw Object.assign(new Error("Task field key must start with a lowercase letter and contain only letters, numbers, or underscores"), {
      code: "validation_failed",
    });
  }
  return normalized;
}

export function validateTaskFieldType(value: string): TaskFieldType {
  if (!TASK_FIELD_TYPES.includes(value as TaskFieldType)) {
    throw Object.assign(new Error(`Unsupported task field type: ${value}`), { code: "validation_failed" });
  }
  return value as TaskFieldType;
}

export function normalizeTaskFieldOptions(options: unknown, type: TaskFieldType): string[] | null {
  if (type !== "select") return null;
  if (!Array.isArray(options)) {
    throw Object.assign(new Error("Select task fields require options"), { code: "validation_failed" });
  }
  const normalized = [...new Set(options.map((option) => String(option).trim()).filter(Boolean))];
  if (normalized.length === 0 || normalized.some((option) => option.length > 191)) {
    throw Object.assign(new Error("Select task field options are invalid"), { code: "validation_failed" });
  }
  return normalized;
}

function invalidValue(definition: TaskFieldDefinitionRecord): never {
  throw Object.assign(new Error(`Invalid value for task field ${definition.key}`), { code: "validation_failed" });
}

function isEmpty(value: unknown) {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

export function normalizeTaskFieldValue(input: {
  definition: TaskFieldDefinitionRecord;
  value: unknown;
  isSpaceMember?: (userId: string) => Promise<boolean>;
}): Promise<{ key: string; definitionId: string; data: Record<string, unknown> }> {
  const { definition, value } = input;
  const type = validateTaskFieldType(definition.type);
  if (isEmpty(value)) {
    if (definition.required) invalidValue(definition);
    return Promise.resolve({ key: definition.key, definitionId: definition.id, data: {} });
  }

  if (type === "text") {
    if (typeof value !== "string" || value.length > 10_000) invalidValue(definition);
    return Promise.resolve({ key: definition.key, definitionId: definition.id, data: { textValue: value } });
  }
  if (type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) invalidValue(definition);
    return Promise.resolve({ key: definition.key, definitionId: definition.id, data: { numberValue: value } });
  }
  if (type === "boolean") {
    if (typeof value !== "boolean") invalidValue(definition);
    return Promise.resolve({ key: definition.key, definitionId: definition.id, data: { booleanValue: value } });
  }
  if (type === "date") {
    const date = value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) invalidValue(definition);
    return Promise.resolve({ key: definition.key, definitionId: definition.id, data: { dateValue: date } });
  }
  if (type === "select") {
    const options = normalizeTaskFieldOptions(definition.options, type) ?? [];
    if (typeof value !== "string" || !options.includes(value)) invalidValue(definition);
    return Promise.resolve({ key: definition.key, definitionId: definition.id, data: { selectValue: value } });
  }
  if (typeof value !== "string" || !input.isSpaceMember) invalidValue(definition);
  return input.isSpaceMember(value).then((isMember) => {
    if (!isMember) invalidValue(definition);
    return { key: definition.key, definitionId: definition.id, data: { userValue: value } };
  });
}

export async function normalizeTaskFieldValues(input: {
  definitions: TaskFieldDefinitionRecord[];
  values: Record<string, unknown> | undefined;
  isSpaceMember: (userId: string) => Promise<boolean>;
}) {
  const values = input.values ?? {};
  const definitionsByKey = new Map(input.definitions.filter((definition) => definition.isActive).map((definition) => [definition.key, definition]));
  for (const key of Object.keys(values)) {
    if (!definitionsByKey.has(key)) {
      throw Object.assign(new Error(`Unknown task field: ${key}`), { code: "validation_failed" });
    }
  }
  const normalized = [] as Array<{ key: string; definitionId: string; data: Record<string, unknown> }>;
  for (const definition of input.definitions.filter((item) => item.isActive)) {
    const field = await normalizeTaskFieldValue({
      definition,
      value: values[definition.key],
      isSpaceMember: input.isSpaceMember,
    });
    if (Object.keys(field.data).length > 0) normalized.push(field);
  }
  return normalized;
}

export function allocateTaskFieldValueId(taskId: string, definitionId: string) {
  const readable = `task-field:${taskId}:${definitionId}`;
  if (readable.length <= 96) return readable;
  return `task-field:${createHash("sha256").update(readable).digest("hex")}`;
}

export function normalizeTaskFieldRecord(input: {
  id: string;
  fieldDefinition: TaskFieldDefinitionRecord;
  textValue: string | null;
  numberValue: number | null;
  dateValue: Date | null;
  booleanValue: boolean | null;
  userValue: string | null;
  selectValue: string | null;
}): NormalizedTaskFieldValue {
  const { fieldDefinition: definition } = input;
  const type = validateTaskFieldType(definition.type);
  const value = type === "text"
    ? input.textValue
    : type === "number"
      ? input.numberValue
      : type === "date"
        ? input.dateValue
        : type === "boolean"
          ? input.booleanValue
          : type === "user"
            ? input.userValue
            : input.selectValue;
  return { id: input.id, fieldDefinitionId: definition.id, key: definition.key, name: definition.name, type, value };
}
