import { parseArrayValues } from './parseArrayValues.js';

const schema = {
  type: 'object',
  properties: {
    names: { type: 'array', items: { type: 'string' } },
    numbers: { type: 'array', items: { type: 'number' } },
    contacts: { type: 'array', items: { $ref: '#/components/schemas/Contact' } },
    reference: { type: 'string' },
    nested: {
      type: 'object',
      properties: {
        array: { type: 'array', items: { type: 'string' } },
        label: { type: 'string' },
      },
    },
    level1: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          arr: { type: 'array', items: { type: 'number' } },
          nested: {
            type: 'object',
            properties: { deepArr: { type: 'array', items: { type: 'number' } } },
          },
        },
      },
    },
    empty: { type: 'array', items: { type: 'string' } },
    string: { type: 'string' },
    number: { type: 'number' },
    boolean: { type: 'boolean' },
    object: { type: 'object', properties: { key: { type: 'string' } } },
    parsed: { type: 'array', items: { type: 'string' } },
  },
  components: {
    schemas: {
      Contact: {
        type: 'object',
        properties: { name: { type: 'string' }, age: { type: 'number' } },
      },
    },
  },
};

const arrayOfStrings = { type: 'array', items: { type: 'string' } };

describe('parseArrayValues', () => {
  it('should handle null and undefined values', () => {
    expect(parseArrayValues(null, arrayOfStrings)).toBeNull();
    expect(parseArrayValues(undefined, arrayOfStrings)).toBeUndefined();
  });

  it('should parse string arrays where the schema declares an array', () => {
    expect(parseArrayValues('["a", "b", "c"]', arrayOfStrings)).toEqual(['a', 'b', 'c']);
    expect(parseArrayValues('[1, 2, 3]', { type: 'array', items: { type: 'number' } })).toEqual([
      1, 2, 3,
    ]);
  });

  it('should handle invalid array strings', () => {
    const invalidArray = '[1, 2, invalid]';
    expect(parseArrayValues(invalidArray, arrayOfStrings)).toBe(invalidArray);
  });

  it('should handle regular strings', () => {
    expect(parseArrayValues('not an array', arrayOfStrings)).toBe('not an array');
    expect(parseArrayValues('[partial bracket', arrayOfStrings)).toBe('[partial bracket');
  });

  it('should parse nested arrays in objects', () => {
    const input = {
      names: '["john", "doe"]',
      numbers: '[1, 2, 3]',
      nested: {
        array: '["nested", "value"]',
      },
    };
    const expected = {
      names: ['john', 'doe'],
      numbers: [1, 2, 3],
      nested: {
        array: ['nested', 'value'],
      },
    };
    expect(parseArrayValues(input, schema)).toEqual(expected);
  });

  it('should handle arrays of objects behind a local reference', () => {
    const input = {
      contacts: '[{"name": "John", "age": 30}, {"name": "Jane", "age": 25}]',
    };
    const expected = {
      contacts: [
        { name: 'John', age: 30 },
        { name: 'Jane', age: 25 },
      ],
    };
    expect(parseArrayValues(input, schema)).toEqual(expected);
  });

  it('should preserve non-array values', () => {
    const input = {
      string: 'hello',
      number: 42,
      boolean: true,
      object: { key: 'value' },
    };
    expect(parseArrayValues(input, schema)).toEqual(input);
  });

  it('should handle already parsed arrays', () => {
    const input = {
      parsed: ['already', 'an', 'array'],
      nested: {
        array: ['parsed', 'array'],
      },
    };
    expect(parseArrayValues(input, schema)).toEqual(input);
  });

  it('should handle empty arrays', () => {
    expect(parseArrayValues('[]', arrayOfStrings)).toEqual([]);
    expect(parseArrayValues({ empty: '[]' }, schema)).toEqual({ empty: [] });
  });

  it('should handle complex nested structures', () => {
    const input = {
      level1: '[{"arr": "[1, 2]", "nested": {"deepArr": "[3, 4]"}}]',
    };
    const expected = {
      level1: [
        {
          arr: [1, 2],
          nested: {
            deepArr: [3, 4],
          },
        },
      ],
    };
    expect(parseArrayValues(input, schema)).toEqual(expected);
  });

  // F107: string fields that merely look like arrays must survive unchanged.
  it('leaves string fields alone even when they look like arrays', () => {
    const input = {
      reference: '[1,2]',
      nested: { label: '[]' },
      contacts: [{ name: '["A","B"]' }],
    };
    expect(parseArrayValues(input, schema)).toEqual(input);
  });

  it('leaves every string alone when no schema is supplied', () => {
    const input = { anything: '["A","B"]' };
    expect(parseArrayValues(input)).toEqual(input);
  });
});
