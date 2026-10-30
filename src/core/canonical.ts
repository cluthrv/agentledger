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
 * Values are first reduced to plain JSON the way JSON.stringify reduces them
 * (toJSONValue below): toJSON() is honored, so a Date becomes its ISO string.
 * What gets hashed is therefore exactly what a saved session file holds.
 *
 * v1 (sortedStringify in hash.ts) passes the top-level keys as a JSON.stringify
 * replacer, which drops nested keys. This function covers every nested value.
 */

export interface ToJSONValueOptions {
  /** Reject NaN and Infinity instead of turning them into null (default false). */
  strictNumbers?: boolean;
}

/**
 * Return a deep copy of `value` reduced to plain JSON, following the rules of
 * JSON.stringify:
 *   - toJSON(key) is called where present (a Date becomes its ISO string)
 *   - object members that are undefined, functions or symbols are dropped;
 *     in arrays they become null
 *   - Map, Set and other objects without enumerable own keys become {}
 *   - NaN and Infinity become null, or throw with `strictNumbers`
 * BigInt and circular references throw, with the path where they occur.
 * The result shares nothing with the input, so later changes to the input
 * cannot reach it.
 */
export function toJSONValue(value: unknown, options: ToJSONValueOptions = {}): unknown {
  return normalize(value, '', '$', new Set(), options.strictNumbers ?? false);
}

function normalize(value: unknown, key: string, path: string, ancestors: Set<object>, strict: boolean): unknown {
  if (value !== null && typeof value === 'object' && typeof (value as { toJSON?: unknown }).toJSON === 'function') {
    value = (value as { toJSON: (k: string) => unknown }).toJSON(key);
  }
  if (value === null) return null;
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value;
    case 'number':
      if (Number.isFinite(value)) return value;
      if (strict) throw new Error(`cannot serialize non-finite number ${value} at ${path}`);
      return null;
    case 'bigint':
      throw new Error(`cannot serialize a bigint at ${path}`);
    case 'undefined':
    case 'function':
    case 'symbol':
      return undefined;
    case 'object': {
      const obj = value as object;
      if (ancestors.has(obj)) throw new Error(`cannot serialize a circular reference at ${path}`);
      ancestors.add(obj);
      let out: unknown;
      if (Array.isArray(obj)) {
        out = obj.map((v, i) => {
          const r = normalize(v, String(i), `${path}[${i}]`, ancestors, strict);
          return r === undefined ? null : r;
        });
      } else {
        const rec = obj as Record<string, unknown>;
        const copy: Record<string, unknown> = {};
        for (const k of Object.keys(rec)) {
          const r = normalize(rec[k], k, `${path}.${k}`, ancestors, strict);
          if (r !== undefined) copy[k] = r;
        }
        out = copy;
      }
      ancestors.delete(obj);
      return out;
    }
    default:
      throw new Error(`cannot serialize a value of type ${typeof value} at ${path}`);
  }
}

export function canonicalJson(value: unknown): string {
  let json: unknown;
  try {
    json = toJSONValue(value, { strictNumbers: true });
  } catch (e) {
    throw new Error(`canonicalJson: ${(e as Error).message}`);
  }
  if (json === undefined) {
    throw new Error(`canonicalJson: cannot serialize a value of type ${typeof value}`);
  }
  return serialize(json);
}

/** Serialize a value that is already plain JSON. */
function serialize(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return '[' + value.map(serialize).join(',') + ']';
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return '{' + Object.keys(obj).sort().map((k) => JSON.stringify(k) + ':' + serialize(obj[k])).join(',') + '}';
  }
  return JSON.stringify(value); // string, number (finite), boolean
}
