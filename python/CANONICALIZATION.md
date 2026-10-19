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

### v2 fix (implemented, 0.2.0)

v2 canonicalization serializes with recursive key sorting (RFC 8785), so all
nested content is covered, in both TypeScript (`hashActionRecordV2`,
`canonicalJson`) and Python (`hash_action_record_v2`, `canonical_json`). It is
versioned: a session file declares `"canonicalization": "v2"` and
`"merkle": "v2"`, sessions without those fields verify under v1 as before, and
v1 and v2 roots are not interchangeable. v2 also changes the Merkle tree to RFC
6962 style leaves and nodes. The exact rules are in [SIGNING.md](../SIGNING.md),
and both languages are tested against shared vectors
(`tests/fixtures/v2_vectors.json`).

## Known v1 cross-language edge cases

Two places where the v1 Python serializer above differs from JavaScript's
`JSON.stringify`. Neither occurs in the recorded demo data, and they are left
as is so existing v1 hashes stay stable. v2 handles both correctly.

- Numbers from 1e-7 up to 1e-4 that Python's `repr` writes in exponent form:
  `0.00001` serializes as `1e-5` here, while JavaScript writes `0.00001`.
- U+2028 and U+2029 are escaped here; `JSON.stringify` leaves them as is.
