# Hashing and signing reference

This is the exact specification of what AgentLedger hashes, signs and anchors.
Two implementations must agree on every byte below to cross-verify, and
TypeScript and Python are tested against shared vectors
(`python/tests/fixtures/v2_vectors.json`).

Hashing has two versions. A session file says which one it uses:

```json
{ "canonicalization": "v2", "merkle": "v2", "session": { ... }, "records": [ ... ] }
```

Both fields absent means v1 (sessions sealed before v2). New sessions from the
MCP demo gateway, or from `new AgentLedgerSession({ canonicalization: "v2" })`,
are v2.

## What v1 did not cover

The v1 record hash serializes `input`, `output` and `metadata` with
`JSON.stringify(obj, Object.keys(obj).sort())`. An array replacer is a property
allowlist applied at every nesting level, so nested keys that are not also
top-level keys are dropped:

```
{ tool: "create_credit_line", args: { amount: 2400000 } }  ->  {"args":{},"tool":"create_credit_line"}
```

A tool call's arguments, and anything nested in its output or metadata, are
therefore not covered by a v1 record hash, by a signature over it, or by a
Merkle root built from it. Under v1, changing `create_credit_line`'s
`args.amount` verifies. v1 is kept so existing sessions and anchored roots
still verify; `python/CANONICALIZATION.md` has the v1 serialization details.

## v2 canonicalization

`canonicalJson` (`src/core/canonical.ts`, `python/src/agentledger/canonical.py`)
follows RFC 8785 (JSON Canonicalization Scheme):

- Object keys sorted by UTF-16 code units, at every depth.
- Object members whose value is `undefined` are dropped (JavaScript). `null` is kept.
- Numbers as ECMAScript `Number.prototype.toString` writes them: `2400000`,
  `0.00001`, `1e-7`, `1e+21`. NaN and Infinity are rejected. `-0` is `0`.
- Strings escaped as `JSON.stringify` escapes them: `\"`, `\\`, `\b \f \n \r \t`,
  other control characters as lowercase `\u00xx`, everything else literal
  (including non-ASCII, U+2028 and U+2029).
- No whitespace. UTF-8 when hashed.

## v2 record hash

```
recordHash = SHA-256( "agentledger/record-hash/v2\n" + canonicalJson(content) )   // lowercase hex
```

`content` is an object with these members:

| Member | Rule |
| --- | --- |
| `id`, `sessionId`, `sequenceNumber`, `timestamp`, `actionType`, `input`, `output` | Always present |
| `previousHash` | Always present: the previous record's hash, `null` for the first record |
| `agentId`, `reasoning`, `metadata` | Left out when null or undefined |

`hash` itself is not part of `content`. `previousHash` links each record to the
previous record's v2 hash, so the chain is v2 end to end.

## Merkle v2

RFC 6962 style, over the records' hashes in sequence order:

```
leaf = SHA-256( 0x00 || recordHash as 32 raw bytes )
node = SHA-256( 0x01 || left as 32 raw bytes || right as 32 raw bytes )
```

- An odd node at the end of a level is carried up to the next level unchanged.
  It is never duplicated.
- The root of one record is its leaf hash. An empty list has no root.
- A proof is the list of sibling hashes from the leaf to the root, each marked
  `left` or `right`. A level where the node is carried up adds no sibling.

v1, for comparison: leaf = `SHA-256(recordHash hex string)`, node =
`SHA-256(left hex + right hex)`, and the odd last node is duplicated.

## Signed messages

All signatures are Ed25519 over the UTF-8 bytes of the message, base64 encoded.
Fields are separated by `\n` (one line feed). Hashes are lowercase hex.

| Message | Exact bytes | Signed by |
| --- | --- | --- |
| Record (v2) | `agentledger/record-sig/v2\n{sessionId}\n{sequenceNumber}\n{recordHash}` | Gateway |
| Checkpoint (v2) | `agentledger/checkpoint/v2\n{sessionId}\n{recordCount}\n{merkleV2Root}` | Gateway |
| Seal (v2) | `agentledger/seal/v2\n{sessionId}\n{recordCount}\n{merkleV2Root}` | Gateway |
| Server receipt | `agentledger/server-receipt/v1\n{server}\n{tool}\n{argsHash}\n{resultHash}\n{issuedAt}` | The server (the bureau in the demo) |
| Record (v1) | `agentledger/record/v1\n{sessionId}\n{sequenceNumber}\n{v1RecordHash}` | Gateway, before v2 |
| Checkpoint / seal (v1) | `agentledger/{checkpoint\|seal}/v1\n{sessionId}\n{recordCount}\n{merkleV1Root}` | Gateway, before v2 |

- The record-hash label (`record-hash/v2`) and the record-signature label
  (`record-sig/v2`) are different, so a hash preimage can never be read as a
  signed message or the reverse.
- A checkpoint is signed every `CHECKPOINT_EVERY` records (default 5) over the
  root of the records so far. The seal is the last checkpoint and covers every
  record.
- Server receipt fields: `argsHash = SHA-256(canonicalJson(arguments received))`,
  `resultHash = SHA-256(canonicalJson(result returned))`, `issuedAt` an ISO 8601
  timestamp.

### No downgrade

The version is part of every signed label and of the Merkle construction. A v2
session relabelled as v1 fails: its signatures are over `record-sig/v2`
messages, which never verify as `record/v1`, and its anchored root is a Merkle
v2 root, which a v1 recomputation never reproduces. The verifiers also reject
files that declare different `canonicalization` and `merkle` versions.

## Key IDs

```
keyId = first 16 hex characters of SHA-256( Ed25519 public key in SPKI DER encoding )
```

A verifier never trusts a public key or key ID found in a session file. It
holds the gateway's and each signing server's public key in advance
(`GATEWAY_PUBLIC_KEY`, `BUREAU_PUBLIC_KEY`, or `data/keys/*.pub.pem` in the
demo) and checks every signature against those.

## Anchoring

The sealed Merkle root is anchored on chain with the AnchorRegistry contract
(`mcp-demo/contracts/AnchorRegistry.sol`):

```
anchor(bytes32 sessionId, bytes32 root)        // write-once per (msg.sender, sessionId)
anchors(address anchorer, bytes32 sessionId)   // -> (root, anchoredAt)
```

- `sessionId` as bytes32: the UUID's 16 bytes, left-padded with zeros to 32 bytes.
- `root`: the session's Merkle root, v2 for v2 sessions.
- A verifier reads `anchors(trustedAnchorer, sessionId)`, with the anchorer
  address pinned in advance. No anchor from a trusted anchorer is a failure
  (`NOT ANCHORED`), never `VERIFIED`.

## MCP `_meta` keys

Receipts travel in the `_meta` of a `tools/call` result:

| Key | Holds |
| --- | --- |
| `io.github.cluthrv/receipt` | Gateway receipt: `sessionId`, `seq`, `hash`, `previousHash`, `keyId`, `signature` |
| `io.github.cluthrv/server-receipt` | Server receipt: `server`, `tool`, `argsHash`, `resultHash`, `issuedAt`, `keyId`, `signature` |

The prefix is a dotted label sequence, the reverse-DNS form of
`cluthrv.github.io`, a domain the project controls, which keeps the keys from
colliding with anyone else's `_meta` keys.
