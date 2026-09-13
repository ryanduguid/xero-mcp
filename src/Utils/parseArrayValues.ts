type JsonSchema = Record<string, any>;

const LOCAL_REF = /^#\/(.+)$/;

/**
 * Resolves a local JSON pointer against the schema document root.
 */
const resolveRef = (ref: string, root: JsonSchema | undefined): JsonSchema | undefined => {
  const match = LOCAL_REF.exec(ref);
  if (!match || !root) return undefined;
  let node: any = root;
  for (const rawSegment of match[1].split("/")) {
    const segment = rawSegment.replace(/~1/g, "/").replace(/~0/g, "~");
    if (node === null || typeof node !== "object") return undefined;
    node = node[segment];
  }
  return node && typeof node === "object" ? node : undefined;
};

const deref = (
  schema: JsonSchema | undefined,
  root: JsonSchema | undefined,
  seen: Set<string> = new Set()
): JsonSchema | undefined => {
  let current = schema;
  while (current && typeof current.$ref === "string") {
    if (seen.has(current.$ref)) return undefined;
    seen.add(current.$ref);
    current = resolveRef(current.$ref, root);
  }
  return current;
};

const expectsArray = (schema: JsonSchema | undefined): boolean => {
  if (!schema) return false;
  const type = schema.type;
  if (type === "array") return true;
  if (Array.isArray(type) && type.includes("array")) return true;
  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    const branches = schema[key];
    if (Array.isArray(branches) && branches.some((branch) => expectsArray(branch))) {
      return true;
    }
  }
  return false;
};

const propertySchema = (
  schema: JsonSchema | undefined,
  key: string
): JsonSchema | undefined => {
  if (!schema) return undefined;
  const properties = schema.properties as JsonSchema | undefined;
  if (properties && typeof properties === "object") {
    if (Object.prototype.hasOwnProperty.call(properties, key)) return properties[key];
    // Clients vary the casing of Xero field names, so fall back to a
    // case-insensitive match before giving up on the property.
    const lower = key.toLowerCase();
    const match = Object.keys(properties).find((name) => name.toLowerCase() === lower);
    if (match) return properties[match];
  }
  const additional = schema.additionalProperties;
  if (additional && typeof additional === "object") return additional as JsonSchema;
  return undefined;
};

/**
 * Converts JSON-encoded array strings into arrays, but only where the tool's
 * input schema declares an array at that position.
 *
 * Some clients send array arguments as a JSON string. Converting every string
 * that merely looks like an array also rewrites ordinary text fields, so a
 * contact name or a line description of `["A","B"]` would reach Xero as an
 * array. The schema decides.
 *
 * @param value the raw argument value
 * @param schema the schema for this value; omit or pass undefined to leave
 *   strings untouched
 * @param root the schema document used to resolve local `$ref` pointers,
 *   defaulting to `schema`
 */
export const parseArrayValues = (
  value: any,
  schema?: JsonSchema,
  root: JsonSchema | undefined = schema
): any => {
  if (value === null || value === undefined) return value;

  const resolved = deref(schema, root);

  if (typeof value === "string") {
    if (!expectsArray(resolved)) return value;
    const trimmed = value.trim();
    if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return value;
    try {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) return value;
      return parseArrayValues(parsed, resolved, root);
    } catch {
      return value;
    }
  }

  if (Array.isArray(value)) {
    const items = resolved?.items as JsonSchema | undefined;
    return value.map((item) => parseArrayValues(item, items, root));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        parseArrayValues(child, propertySchema(resolved, key), root),
      ])
    );
  }

  return value;
};
