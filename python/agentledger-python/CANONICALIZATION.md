# Canonicalization (v1)

The record hash is a SHA-256 over a canonical string built from the record's
content fields in a fixed order. To interoperate with the TypeScript library
and with already-anchored sessions, the Python SDK reproduces the TypeScript
canonicalization **exactly**, including its quirks. This document records what
that means and where v1 is weaker than it looks.

## Field order

```
[ id, sessionId, sequenceNumber, timestamp, agentId, actionType,
  sortedStringify(input), sortedStringify(output),
  reasoning ?? '', metadata ? sortedStringify(metadata) : '',
  previousHash ?? '' ]
```

The array is serialized with `JSON.stringify` (no whitespace) and hashed.

- `agentId` absent serializes as JSON `null`.
- `metadata` is gated on truthiness: any object, including `{}`, is serialized;
  only `null`/absent yields `''`.
- `reasoning` and `previousHash` use nullish coalescing: only `null`/absent
  become `''`.

## Number formatting

Numbers follow ECMAScript `Number::toString`, not Python's `json`:

| value | canonical |
|---|---|
| `149.0` | `149` |
| `-3.0` | `-3` |
| `0.0` | `0` |
| `126.65` | `126.65` |
| `1e21` | `1e+21` |
| `1e-7` | `1e-7` |
| `NaN`, `Infinity` | `null` |

The Python SDK emits numbers with a custom serializer to match. Extremely
large or small floats outside the common range are best-effort; agent payloads
should prefer integers, strings, and ordinary decimals, which are exact.

## Known limitation: nested object keys are dropped (v1)

`sortedStringify` is implemented in TypeScript as:

```js
JSON.stringify(obj, Object.keys(obj).sort())
```

Passing an array as the `JSON.stringify` replacer makes it a **property
allowlist applied at every nesting level**. The allowlist contains only the
object's top-level keys, so any nested object key that is not also a top-level
key is dropped from the canonical string.

Example:

```
sortedStringify({ tool: "get_account", args: { customerId: "MER-100" } })
  -> {"args":{},"tool":"get_account"}
```

The nested `customerId` is not covered by the hash. In practice this means
nested fields (for example a tool call's arguments) can be altered without
changing the record hash. Flat fields are fully covered.

The Python SDK **reproduces this behavior** so v1 hashes match across
languages and existing anchored roots keep verifying.

### Planned v2 fix

A v2 canonicalization will serialize with proper recursive key sorting so all
nested content is covered, in both the TypeScript and Python implementations.
It will be versioned (for example a `canonicalVersion` field or a distinct
hashing function) so that sessions sealed under v1 continue to verify under v1
and only new sessions use v2. v1 and v2 roots are not interchangeable.
