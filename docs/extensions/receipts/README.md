# Signed tool-call receipts for MCP

| | |
| --- | --- |
| **Extension identifier** | `io.github.cluthrv/receipts` |
| **`_meta` keys** | `io.github.cluthrv/server-receipt`, `io.github.cluthrv/receipt` |
| **Revision** | `0` |
| **Stage** | Experimental, third-party (not an official MCP extension) |
| **Author** | Vikas Luthra |
| **Reference implementation** | [`mcp-demo/`](../../../mcp-demo/) and [`@vluthra/agent-ledger`](https://www.npmjs.com/package/@vluthra/agent-ledger) / [`vluthra-agent-ledger`](https://pypi.org/project/vluthra-agent-ledger/) |
| **Test vectors** | [`vectors.json`](vectors.json), checked by [`check-vectors.mjs`](check-vectors.mjs) |

## 1. Abstract

An MCP tool result says what a server returned, but nothing in it lets anyone
check that later. This extension adds two signed receipts that travel in the
`_meta` of a `tools/call` result:

- a **server receipt**, signed by the MCP server, binding the tool name, the
  arguments it received and the result it returned;
- a **gateway receipt**, signed by the client-side component that records the
  call, binding that call to a numbered position in a hash-chained session log
  whose Merkle root can be anchored externally.

Each receipt can be checked offline, with nothing but the signer's public key,
which the verifier holds in advance. Together they give two independent
signatures over the same call: one from each side of the protocol.

The extension is optional and additive. A peer that does not support it ignores
the `_meta` keys, and tool calls work exactly as without it.

## 2. Conventions

The key words MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT,
RECOMMENDED, MAY and OPTIONAL are to be interpreted as described in
[BCP 14](https://www.rfc-editor.org/info/bcp14) (RFC 2119, RFC 8174) when, and
only when, they appear in all capitals.

**Roles**

- **Server**: an MCP server that signs the results of its tools.
- **Gateway**: the component on the client side that sits between the host
  and the servers, records every `tools/call`, and signs what it recorded. It
  may be part of the host or a separate proxy.
- **Holder**: whoever keeps the receipts and the records, for example the
  operator of the agent or an auditor.
- **Verifier**: whoever checks the receipts, possibly much later and on
  another machine.

**Encodings**

- `JCS(x)`: the JSON Canonicalization Scheme ([RFC 8785](https://www.rfc-editor.org/rfc/rfc8785))
  serialization of the JSON value `x`, as UTF-8.
- `SHA256(b)`: the SHA-256 digest of the bytes `b`, as 64 lowercase hex characters.
- Signatures are Ed25519 ([RFC 8032](https://www.rfc-editor.org/rfc/rfc8032))
  over the UTF-8 bytes of a message, encoded as standard base64 with padding.
- `\n` is a single line feed (U+000A). Messages have no trailing line feed.

## 3. What a receipt proves, and what it does not

A valid **server receipt** proves that the holder of the server's private key
signed the statement "tool `T` on server `S` received arguments hashing to
`A` and returned a result hashing to `R`, at the time it calls `issuedAt`".

A valid **gateway receipt** proves that the holder of the gateway's private key
recorded a record with hash `H` at position `seq` of session `sessionId`, after
the record with hash `previousHash`. Because the record hash covers every
field of the record, nested ones included, the receipt fixes the arguments,
the result and the server receipt that the gateway recorded.

Neither receipt proves:

- that the result is correct, or that the tool was the right one to call;
- that every call was recorded (a party that controls the gateway can leave
  calls out; anchoring the session root bounds when the log was fixed, not what
  it omits);
- when the call happened (`issuedAt` is asserted by the signer; an external
  anchor gives an upper bound);
- anything about content blocks that are not covered (see section 5.3).

A receipt is post-execution evidence. It does not authorize a call and does not
replace pre-execution checks or attestations of intent.

## 4. Negotiation

### 4.1 Advertising

A server that signs results SHOULD advertise the extension in its
capabilities: in the `server/discover` result for protocol `2026-07-28` and
later, or in the `initialize` result for `2025-11-25` and earlier.

```json
{
  "capabilities": {
    "tools": {},
    "extensions": {
      "io.github.cluthrv/receipts": {
        "revision": "0",
        "serverReceipts": { "server": "bureau", "keyIds": ["06e3fd8fda29bb60"] }
      }
    }
  }
}
```

| Setting | Type | Meaning |
| --- | --- | --- |
| `revision` | string | The revision of this specification the peer implements. REQUIRED. |
| `serverReceipts.server` | string | The `server` value the server puts in its receipts. REQUIRED when `serverReceipts` is present. |
| `serverReceipts.keyIds` | string[] | Key IDs (section 7) the server signs with. Informational: a verifier MUST NOT trust a key because it is listed here. |

A client or gateway that checks receipts SHOULD advertise
`{"io.github.cluthrv/receipts": {"revision": "0"}}` in its client capabilities.
A server MUST attach receipts whether or not the client advertises the
extension, because the receipt is evidence for the holder, not a feature of the
connection.

### 4.2 The obligation that follows

A server that advertises `serverReceipts` MUST attach a server receipt to
every `tools/call` result it returns with `isError` absent or `false`.

For results with `isError: true`, the server SHOULD return a
`structuredContent` describing the error and sign it like any other result. If
it cannot, it MUST omit the receipt, and the verifier classifies the result as
`unsigned-error` (section 8), not `missing`.

This makes absence meaningful. A verifier that knows a server signs every
result, from the advertisement recorded at connection time or from its own
configuration, treats a result without a receipt as a failure (`missing`),
never as a result that was not expected to carry one.

### 4.3 Configuration instead of advertising

A verifier MAY learn which servers sign, and with which keys, from its own
configuration instead of from capabilities. The reference implementation does
this: the verifier holds a pinned public key per signing server, and a pin
means "this server signs every result". The effect is the same as section 4.2.
Capability advertisement does not replace pinning keys (section 7).

## 5. Server receipt

### 5.1 Object

The server receipt is a JSON object in the tool result's `_meta`, under the key
`io.github.cluthrv/server-receipt`.

| Field | Type | Value |
| --- | --- | --- |
| `server` | string | A stable name for the server. It MUST NOT contain a line feed. |
| `tool` | string | The name of the tool called. It MUST NOT contain a line feed. |
| `argsHash` | string | `SHA256(JCS(arguments))`, over the `arguments` object of the `tools/call` request as the server received it. If the request had no `arguments`, the empty object `{}`. |
| `resultHash` | string | `SHA256(JCS(structuredContent))`, over the `structuredContent` of the result. |
| `issuedAt` | string | The time of signing: RFC 3339, UTC, with a `Z` suffix and millisecond precision, for example `2026-10-23T16:05:12.345Z`. It MUST NOT contain a line feed. |
| `keyId` | string | The key ID (section 7) of the signing key. |
| `signature` | string | The Ed25519 signature over the message in section 5.2. |

A server MUST NOT add members that change the meaning of the receipt. Unknown
members MUST be ignored by verifiers; they are not signed.

### 5.2 Signed message

```
agentledger/server-receipt/v1\n{server}\n{tool}\n{argsHash}\n{resultHash}\n{issuedAt}
```

The first line is a domain-separation label: a signature over this message can
never be valid for another kind of message in this extension or in AgentLedger.

### 5.3 What the result hash covers

`resultHash` covers `structuredContent` and nothing else. A server that signs
results:

- MUST return the signed value as `structuredContent`;
- SHOULD declare an `outputSchema` for the tool;
- MAY also return `content` blocks, for example the same JSON as text for
  clients that only read text. Those blocks are not covered by the receipt.

A client that relies on a signed result MUST use `structuredContent`, or
check that the content it uses matches `structuredContent`. Text, images,
resource links and `_meta` outside the receipt are not signed.

### 5.4 Example

```json
{
  "content": [{ "type": "text", "text": "{\"score\":580,\"previousQuarter\":690}" }],
  "structuredContent": { "score": 580, "previousQuarter": 690 },
  "_meta": {
    "io.github.cluthrv/server-receipt": {
      "server": "bureau",
      "tool": "get_credit_score",
      "argsHash": "<SHA256(JCS({\"customerId\":\"MER-100\"}))>",
      "resultHash": "<SHA256(JCS({\"previousQuarter\":690,\"score\":580}))>",
      "issuedAt": "2026-10-23T16:05:12.345Z",
      "keyId": "<key id>",
      "signature": "<base64 Ed25519 signature>"
    }
  }
}
```

[`vectors.json`](vectors.json) has this example with real values.

## 6. Gateway receipt

### 6.1 Object

The gateway records each `tools/call` as a record in a hash-chained session
and returns the result to the host with a gateway receipt in `_meta`, under
the key `io.github.cluthrv/receipt`. The gateway MUST preserve any server
receipt in the result, and SHOULD record it in the record's
`metadata.serverReceipt`, so that the gateway's signature also covers the
server's.

| Field | Type | Value |
| --- | --- | --- |
| `sessionId` | string | The session's identifier, a UUID. |
| `seq` | number | The record's position in the session, from 0. |
| `hash` | string | The record's v2 hash (section 6.3). |
| `previousHash` | string or null | The previous record's hash; `null` for `seq` 0. |
| `keyId` | string | The key ID of the gateway's signing key. |
| `signature` | string | The Ed25519 signature over the message in section 6.2. |

### 6.2 Signed message

```
agentledger/record-sig/v2\n{sessionId}\n{seq}\n{hash}
```

`seq` is written in decimal without leading zeros.

### 6.3 Record and record hash

A record is a JSON object with the members `id`, `sessionId`, `sequenceNumber`,
`timestamp`, `actionType`, `input`, `output` and `previousHash`, and optionally
`agentId`, `reasoning` and `metadata`. For a tool call, `actionType` is
`"tool_call"`, `input` is `{"tool": <name>, "args": <arguments>}` and `output` is
the result's `structuredContent`.

```
hash = SHA256( "agentledger/record-hash/v2\n" || JCS(content) )
```

`content` holds `id`, `sessionId`, `sequenceNumber`, `timestamp`, `actionType`,
`input`, `output` and `previousHash` (`null` for the first record), plus
`agentId`, `reasoning` and `metadata` when they are present and not `null`.
The record-hash label differs from the signature label, so a hash preimage is
never a signed message.

The chain, the Merkle tree over record hashes, checkpoints, the seal and on-chain
anchoring are specified in [SIGNING.md](../../../SIGNING.md). A verifier can
check a gateway receipt on its own; the session gives it context.

## 7. Keys

```
keyId = first 16 hex characters of SHA256( Ed25519 public key, SubjectPublicKeyInfo DER )
```

- A verifier MUST hold the public key of each server and gateway it trusts in
  advance, from its own configuration: a config repository, a key management
  system, an auditor's machine, or a published key the verifier has chosen to
  trust.
- A verifier MUST NOT trust a public key, a key ID or a capability setting
  found in a tool result, a session file or any other document it is
  verifying. `keyId` only selects among keys the verifier already trusts.
- Rotation: a signer that rotates keys keeps signing with the new key, and the
  verifier adds the new key to its pins. Old receipts stay verifiable for as
  long as the verifier keeps the old key pinned.
- Revocation, and deciding whether a key was trusted at `issuedAt`, are the
  verifier's policy and out of scope for this revision. Because `issuedAt` is
  asserted by the signer, a verifier that needs a time it does not have to take
  on trust SHOULD rely on an external anchor of the session (SIGNING.md).

## 8. Verification

### 8.1 Server receipt

Given the pinned key for server `S`, the `tools/call` request's `arguments`, the
result, and the expected tool `T`:

1. No receipt: `unsigned-error` if the result has `isError: true`; otherwise
   `missing`.
2. A required member absent or not a string: `malformed`.
3. `server` is not `S`, or `tool` is not `T`: `wrong-target`.
4. The signature does not verify under a pinned key of `S` for the message in
   section 5.2: `bad-signature`.
5. `argsHash` is not `SHA256(JCS(arguments))`: `args-mismatch`.
6. `resultHash` is not `SHA256(JCS(structuredContent))`: `result-mismatch`.
7. Otherwise: `valid`.

A verifier MUST check the signature before it reports a hash mismatch as
meaningful: an unsigned hash is not evidence.

### 8.2 Gateway receipt

Given the pinned gateway key and the record:

1. No receipt: `missing`.
2. The signature does not verify for the message in section 6.2:
   `bad-signature`.
3. `sessionId`, `seq` or `previousHash` differ from the record's:
   `wrong-record`.
4. `hash` is not the record's v2 hash (section 6.3): `hash-mismatch`.
5. Otherwise: `valid`. If the record carries `metadata.serverReceipt`, verify
   it as in section 8.1 against the record's `input.args` and `output`.

### 8.3 Results

Only `valid` is a success. `missing` is a failure whenever the verifier
expected a receipt (section 4.2). A verifier SHOULD report which check failed,
using the names above, so results are comparable across implementations.

## 9. Security considerations

- **Replay.** A server receipt is not bound to one request: two identical calls
  that return identical results produce receipts that differ only in
  `issuedAt`. The gateway receipt binds a call to one position in one session.
  A verifier that needs request binding uses the gateway receipt.
- **Arguments as received.** `argsHash` is over the arguments the server
  received. A gateway that rewrites arguments records what it sent; a mismatch
  between the recorded arguments and `argsHash` is detected (`args-mismatch`).
- **Low-entropy values.** Hashes are not encryption. If the arguments or the
  result can be guessed (an account number, a yes or no answer), anyone holding
  the hash can confirm a guess. Holders SHOULD treat receipts as being as
  sensitive as the data they cover.
- **Key compromise.** Whoever holds a signing key can sign anything. A
  compromised gateway key lets an attacker write a consistent false session, up
  to the point it was anchored. Anchoring the sealed root to a location the
  gateway operator cannot rewrite is what limits this (SIGNING.md).
- **Self-asserted fields.** `server` and `issuedAt` are asserted by the signer.
  The verifier decides which key speaks for which server.
- **Uncovered content.** Only `structuredContent` is signed (section 5.3).
  Clients MUST NOT present unsigned content as verified.
- **Canonicalization.** Both sides MUST produce identical JCS bytes. Values
  JSON cannot represent exactly (NaN, Infinity, integers beyond 2^53) SHOULD
  NOT appear in signed values.

## 10. Relationship to other work

- **Request-side audit context.** [SEP-2817](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/2817)
  proposes client-asserted context (`invocationReason`, `turnId`) in request
  `_meta`. Recorded in the gateway's record, such context is covered by the
  gateway receipt; it remains client-asserted.
- **Pre-execution attestation.** Proposals such as
  [SEP-2787](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/2787)
  sign the intent before a call. This extension signs the outcome after it.
  The two compose.
- **Other receipt and attestation proposals.** [#3350](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/3350),
  [#3354](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/3354)
  and [#3471](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/3471)
  address related problems: delivery outcomes, proofs of computation, and
  privacy-preserving receipts. This revision is offered as implementation
  experience toward a shared design, not as a competing standard.

## 11. Reference implementation and test vectors

- Server receipts: [`mcp-demo/servers/bureau-server.js`](../../../mcp-demo/servers/bureau-server.js).
- Gateway receipts, checkpoints and the seal: [`mcp-demo/host/gateway.js`](../../../mcp-demo/host/gateway.js).
- Verification, including on-chain anchors: [`mcp-demo/host/verify.js`](../../../mcp-demo/host/verify.js).
- Record hashing and Merkle trees: `@vluthra/agent-ledger` (TypeScript) and
  `vluthra-agent-ledger` (Python), which produce identical hashes.

The reference implementation pins keys by configuration (section 4.3). It does
not yet advertise the extension in capabilities.

[`vectors.json`](vectors.json) holds the RFC 8032 test keys, a server receipt
and a gateway receipt with every intermediate value (canonical bytes, signed
messages, hashes), and negative cases with the expected result of section 8.
[`check-vectors.mjs`](check-vectors.mjs) verifies them using only `node:crypto`,
with canonicalization and verification written from this document rather than
imported from the reference implementation:

```bash
node docs/extensions/receipts/check-vectors.mjs
```

To regenerate the vectors (run `npm run build` at the repository root first):

```bash
node docs/extensions/receipts/make-vectors.mjs
```

## 12. Changes

- **Revision 0** (2026-10-30): first published revision. Describes the receipts
  used by the reference implementation since October 2026, and adds the
  extension identifier, capability settings, the `structuredContent` rule and
  the verification outcomes.
