# AgentLedger (Python)

Cryptographic audit trails for AI agent operations, using SHA-256 hash chains and Merkle trees.

This is the Python SDK for AgentLedger. It is a port of the TypeScript library [`@vluthra/agent-ledger`](https://www.npmjs.com/package/@vluthra/agent-ledger) and produces **identical record hashes and Merkle roots**, v1 and v2. A session sealed by the TypeScript library verifies in Python, and a session sealed in Python verifies with the TypeScript library. That cross-language equivalence is enforced by the test suite.

## Install

```bash
pip install vluthra-agent-ledger
```

The import name is `agentledger`. (The `agent-ledger` name on PyPI belongs to a different project; this package's name matches the npm package `@vluthra/agent-ledger`.)

Zero runtime dependencies. Python 3.10+.

To use the latest code from GitHub instead:

```bash
pip install "git+https://github.com/cluthrv/agentledger.git#subdirectory=python"
```

## Quick start

```python
import json
from agentledger import AgentLedgerSession, ActionType

session = AgentLedgerSession(agent_id="pricing-agent", platform="mcp", canonicalization="v2")

session.record(
    action_type=ActionType.QUERY,
    input={"query": "Get dealer pricing for SKU-1234"},
    output={"price": 149.99, "currency": "USD"},
    reasoning="Retrieved base price from CPQ price book",
)
session.record(
    action_type=ActionType.CALCULATION,
    input={"basePrice": 149.99, "discountPct": 15},
    output={"finalPrice": 127.49},
    reasoning="Applied Gold tier discount",
)

sealed = session.seal()
print("Merkle root:", sealed.merkle_root)

result = session.verify()
print("Valid:", result.valid)

# Prove one record without revealing the others (O(log n))
proof = session.prove_record(1)
print("Proof valid:", session.verify_proof(proof))

# Save it; check the saved file later, anywhere (see below)
with open("session.json", "w", encoding="utf-8") as f:
    json.dump(session.export(), f)
```

`record()` stores a plain-JSON copy of what you pass, so later changes to your own objects do not affect the session, and the records it returns are copies too. Tuples become lists, an Enum becomes its value, and a timezone-aware `datetime` becomes an ISO string in UTC, as JavaScript writes it. Values JSON cannot hold, such as sets, naive datetimes or circular references, raise an error that says where they are (for example `input: cannot serialize a naive datetime at $.args.when`).

## v2 hashing

v2 record hashes cover every field, nested ones such as tool arguments included; v1 hashes do not (see [CANONICALIZATION.md](https://github.com/cluthrv/agentledger/blob/main/python/CANONICALIZATION.md)). v2 also uses an RFC 6962 style Merkle tree. Both match the TypeScript library byte for byte, and [SIGNING.md](https://github.com/cluthrv/agentledger/blob/main/SIGNING.md) has the exact rules.

Turn it on per session with `AgentLedgerSession(..., canonicalization="v2")`. v1 stays the default, so existing sessions hash and verify as before. A v2 export says so in its summary (`"canonicalization": "v2"`, `"merkle": "v2"`). Under v2, NaN and Infinity are rejected rather than stored as `null`.

`verify_exported_session` reads `"canonicalization"` and `"merkle"` from the session summary or the top level of the document, and verifies v2 sessions with v2 and older ones with v1. Conflicting versions fail.

The building blocks are exported too:

```python
from agentledger import hash_action_record_v2, compute_merkle_root_v2, canonical_json
```

## Verifying a session someone else sealed

An auditor can verify an exported session document (the `{session, records, anchor}` shape produced by either implementation) without rebuilding the session:

```python
import json
from agentledger import verify_exported_session

with open("session.json", encoding="utf-8") as f:
    doc = json.load(f)

result = verify_exported_session(doc)
for check in result.checks:
    print(check.name, check.passed, check.detail)
print("Overall:", result.valid)
```

It runs the same checks as `verifyExportedSession` in the TypeScript library: `hash_version`, `hash_chain_integrity`, `session_consistency` (every record belongs to this session and none are missing) and, for a sealed session, `merkle_root_integrity`.

When the document carries an `anchor` block, `verify_exported_session` also checks that the recomputed Merkle root matches the root cached in that block. That cached copy is not independent: whoever can edit the records can edit it too. To check against the chain itself, pass the anchor source from your own configuration:

```python
from agentledger import OnChainAnchor, verify_exported_session

onchain = OnChainAnchor(
    rpc_url="https://sepolia-rollup.arbitrum.io/rpc",
    contract="0x...",                   # the AnchorRegistry address
    trusted_anchorers=["0x..."],        # the gateway wallet(s) you trust
)
result = verify_exported_session(doc, onchain=onchain)
```

This adds an `anchored_root_onchain` check that reads the root anchored for this session id by a trusted address (stdlib only, one `eth_call`). It fails closed if the chain can't be reached.

## API

### `AgentLedgerSession`

| Method | Description |
|---|---|
| `AgentLedgerSession(agent_id, initiator=None, platform=None, metadata=None, canonicalization="v1")` | Create a session (`"v2"` covers nested fields) |
| `record(action_type, input=None, output=None, reasoning=None, metadata=None, agent_id=None)` | Record and chain an action |
| `seal()` | Compute the Merkle root and seal the session |
| `verify()` | Verify chain + root integrity |
| `prove_record(index)` | Generate a Merkle proof for one record |
| `verify_proof(proof)` | Verify a Merkle proof |
| `get_record(index)` / `get_records()` | Copies of the records |
| `get_hash_version()` | `"v1"` or `"v2"` |
| `export()` | Export `{session, records}` as camelCase dicts (a copy) |

### Action types

`QUERY`, `UPDATE`, `CREATE`, `DELETE`, `DECISION`, `ESCALATION`, `TOOL_CALL`, `CALCULATION`, `VALIDATION` — string values identical to the TypeScript enum.

### Low-level utilities

`sha256`, `hash_action_record`, `hash_action_record_v2`, `canonical_json`, `to_json_value`, `combine_hashes`, `sorted_stringify`, `compute_merkle_root`, `compute_merkle_root_v2`, `generate_merkle_proof`, `generate_merkle_proof_v2`, `verify_merkle_proof`, `verify_merkle_proof_v2`, `create_action_record`, `verify_chain`, `verify_action_record`, `verify_exported_session`, `OnChainAnchor`, `read_onchain_anchor`, `session_id_to_bytes32`. `create_action_record`, `verify_action_record` and `verify_chain` take a `version` argument (`"v1"`, the default, or `"v2"`).

## Cross-language equivalence

The hashes are byte-for-byte identical to the TypeScript library because the canonical serialization reproduces JavaScript's `JSON.stringify` exactly, including its number formatting (integer-valued floats such as `149.0` serialize as `149`). See [`CANONICALIZATION.md`](https://github.com/cluthrv/agentledger/blob/main/python/CANONICALIZATION.md) for the details and one documented v1 limitation.

`examples/cross_language/` contains a runnable round-trip: it seals a v2 session in Python and verifies it with the published npm package via Node. The test suite covers the other direction with a session exported by the TypeScript library.

## What it does and does not cover

AgentLedger verifies the integrity of the records submitted to it. It detects changes to recorded actions after sealing and confirms a record belongs to an anchored session. It does not prove that the agent recorded every action that occurred, and it does not independently confirm that recorded values match the underlying operation. Anchoring the sealed root to an independent, externally controlled location is what protects against a privileged actor rewriting both the records and the fingerprint.

## License

MIT. See [LICENSE](https://github.com/cluthrv/agentledger/blob/main/python/LICENSE).

## Author

Vikas Luthra.
