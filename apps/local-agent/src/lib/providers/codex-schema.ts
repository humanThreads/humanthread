const CODEX_SCHEMA_KEYS = new Set([
  "$defs",
  "$ref",
  "additionalProperties",
  "allOf",
  "anyOf",
  "const",
  "enum",
  "items",
  "properties",
  "required",
  "type",
]);

type JsonSchemaObject = Record<string, unknown>;

function projectNode(schema: unknown): unknown {
  if (typeof schema === "boolean") return schema;
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return schema;

  const source = schema as JsonSchemaObject;
  const projected: JsonSchemaObject = {};
  for (const key of CODEX_SCHEMA_KEYS) {
    if (!Object.hasOwn(source, key)) continue;
    const value = source[key];
    if (key === "properties" && value && typeof value === "object" && !Array.isArray(value)) {
      projected.properties = Object.fromEntries(
        Object.entries(value as JsonSchemaObject).map(([property, propertySchema]) => [property, projectNode(propertySchema)]),
      );
      continue;
    }
    if ((key === "anyOf" || key === "allOf") && Array.isArray(value)) {
      projected[key] = value.map(projectNode);
      continue;
    }
    if (key === "$defs" && value && typeof value === "object" && !Array.isArray(value)) {
      projected.$defs = Object.fromEntries(
        Object.entries(value as JsonSchemaObject).map(([definition, definitionSchema]) => [definition, projectNode(definitionSchema)]),
      );
      continue;
    }
    if (key === "items" || key === "additionalProperties") {
      projected[key] = typeof value === "object" && value !== null ? projectNode(value) : value;
      continue;
    }
    if (key === "type" && Array.isArray(value)) {
      projected.anyOf = value.map((type) => ({ type }));
      continue;
    }
    projected[key] = value;
  }
  return projected;
}

/**
 * OpenAI-compatible Codex structured outputs accept a deliberately small
 * JSON-Schema subset. Keep semantic shape keywords and remove validation and
 * annotation keywords that the Provider rejects (for example `uniqueItems`,
 * `pattern`, `minLength`, and `format`).
 */
export function projectCodexStructuredOutputSchema(schema: unknown): unknown {
  return projectNode(schema);
}
