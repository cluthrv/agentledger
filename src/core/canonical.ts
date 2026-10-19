/**
 * Canonical JSON (v2)
 *
 * Deterministic serialization used by the v2 record hash, following RFC 8785
 * (JSON Canonicalization Scheme):
 *   - object keys sorted by UTF-16 code units, at every depth
 *   - object members whose value is undefined are dropped
 *   - numbers in ECMAScript Number.prototype.toString form (what JSON.stringify
 *     emits for finite numbers); NaN and Infinity are rejected
 *   - strings escaped as JSON.stringify escapes them
 *   - no whitespace
 *
 * v1 (sortedStringify in hash.ts) passes the top-level keys as a JSON.stringify
 * replacer, which drops nested keys. This function covers every nested value.
 */

export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new Error(`canonicalJson: cannot serialize non-finite number ${value}`);
      }
      return JSON.stringify(value);
    case 'string':
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        // An undefined array element serializes as null, as in JSON.stringify.
        return '[' + value.map((v) => (v === undefined ? 'null' : canonicalJson(v))).join(',') + ']';
      }
      const obj = value as Record<string, unknown>;
      const members = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + canonicalJson(obj[k]));
      return '{' + members.join(',') + '}';
    }
    default:
      throw new Error(`canonicalJson: cannot serialize a value of type ${typeof value}`);
  }
}
