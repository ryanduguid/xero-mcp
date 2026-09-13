import { XeroAccountingApiSchema } from "../Resources/xero_accounting.js";

const LOCAL_SCHEMA_REF = /^#\/components\/schemas\/(.+)$/;

type SchemaMap = Record<string, any>;

/**
 * Collects every component schema reachable from a schema fragment.
 *
 * Tool input schemas copy property definitions out of the bundled OpenAPI
 * document, and those copies keep their "#/components/schemas/..." pointers.
 * Attaching the result of this function to the input schema as its
 * `components` member gives those pointers a target inside the same document,
 * so a client that resolves or compiles the schema can do so without the
 * whole OpenAPI file.
 */
export const collectSchemaComponents = (
  fragment: unknown
): { schemas: SchemaMap } => {
  const schemas: SchemaMap = (XeroAccountingApiSchema as any).components
    .schemas;
  const collected: SchemaMap = {};

  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (node === null || typeof node !== "object") return;

    for (const [key, value] of Object.entries(node as SchemaMap)) {
      if (key === "$ref" && typeof value === "string") {
        const match = LOCAL_SCHEMA_REF.exec(value);
        if (!match) continue;
        const name = match[1];
        if (name in collected) continue;
        const target = schemas[name];
        if (target === undefined) continue;
        collected[name] = target;
        visit(target);
        continue;
      }
      visit(value);
    }
  };

  visit(fragment);
  return { schemas: collected };
};
