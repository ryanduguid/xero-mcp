import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import type { JsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/types';
import type { IMcpServerTool } from '../Tools/IMcpServerTool.js';
import { convertKeyToCamelCase } from './convertToCamelCase.js';
import { deref, JsonSchema, parseArrayValues } from './parseArrayValues.js';

const provider = new AjvJsonSchemaValidator();
const validators = new WeakMap<IMcpServerTool, JsonSchemaValidator<unknown>>();

// These handlers decode array strings and convert Xero payload keys. Other
// tools use their arguments directly, so their validation must do the same.
const payloads: Record<string, true | string> = {
  create_contacts: true,
  create_bank_transactions: true,
  update_bank_transaction: 'bankTransactions',
  update_invoice: 'invoices',
};

export function validateToolArguments(
  tool: IMcpServerTool,
  args: Record<string, unknown> | undefined,
): void {
  const schema = tool.requestSchema.inputSchema;
  let validate = validators.get(tool);
  if (!validate) {
    validate = provider.getValidator(schema);
    validators.set(tool, validate);
  }
  const payload = payloads[tool.requestSchema.name];
  const supplied = args === undefined ? {} : args;
  const decoded = payload === undefined ? supplied : parseArrayValues(supplied, schema);

  const invalid = (message: string): never => {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Invalid arguments for tool ${tool.requestSchema.name}: ${message}`,
    );
  };

  // Build a validation copy in the schema's spelling. The original request
  // still follows its existing handler's normalisation and API mapping.
  const prepare = (
    value: unknown,
    current: JsonSchema | undefined,
    normaliseKeys: boolean,
    path: string,
  ): unknown => {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      return invalid(`A finite number is required at ${path || '/'}.`);
    }
    const resolved = deref(current, schema);
    if (Array.isArray(value)) {
      return value.map((child, index) =>
        prepare(child, resolved?.items, normaliseKeys, `${path}/${index}`),
      );
    }
    if (value !== null && typeof value === 'object') {
      const properties = resolved?.properties ?? {};
      const names = Object.keys(properties);
      const used = new Set<string>();
      return Object.fromEntries(Object.entries(value).map(([key, child]) => {
        const mapped = normaliseKeys ? convertKeyToCamelCase(key) : key;
        if (used.has(mapped)) return invalid(`Ambiguous fields at ${path || '/'}.`);
        used.add(mapped);
        const declared = normaliseKeys
          ? names.find((name) => convertKeyToCamelCase(name) === mapped)
          : names.find((name) => name === key);
        const target = declared ?? key;
        const childSchema = declared === undefined
          ? (typeof resolved?.additionalProperties === 'object' ? resolved.additionalProperties : undefined)
          : properties[declared];
        const childPath = `${path}/${target.replace(/~/g, '~0').replace(/\//g, '~1')}`;
        return [target, prepare(
          child,
          childSchema,
          normaliseKeys || (path === '' && key === payload),
          childPath,
        )];
      }));
    }
    return value;
  };

  const result = validate(prepare(decoded, schema, payload === true, ''));
  if (!result.valid) invalid(result.errorMessage ?? 'The input schema was not satisfied.');
}
