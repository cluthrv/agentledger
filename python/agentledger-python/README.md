# AgentLedger (Python)

Cryptographic audit trails for AI agent operations, using SHA-256 hash chains and Merkle trees.

This is the Python SDK for AgentLedger. It is a faithful port of the TypeScript library [`@vluthra/agent-ledger`](https://www.npmjs.com/package/@vluthra/agent-ledger) and produces **identical record hashes and Merkle roots**. A session sealed by the TypeScript library verifies in Python, and a session sealed in Python verifies with the TypeScript library. That cross-language equivalence is enforced by the test suite.

## Install

```bash
pip install agent-ledger
```

Zero runtime dependencies. Python 3.9+.

## Quick start

```python
from agentledger import AgentLedgerSession, ActionType

session = AgentLedgerSession(agent_id="pricing-agent", platform="mcp")

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

When the document carries an `anchor` block, `verify_exported_session` also checks that the recomputed Merkle root matches the anchored on-chain root.

## API

### `AgentLedgerSession`

| Method | Description |
|---|---|
| `AgentLedgerSession(agent_id, initiator=None, platform=None, metadata=None)` | Create a session |
| `record(action_type, input=None, output=None, reasoning=None, metadata=None, agent_id=None)` | Record and chain an action |
| `seal()` | Compute the Merkle root and seal the session |
| `verify()` | Verify chain + root integrity |
| `prove_record(index)` | Generate a Merkle proof for one record |
| `verify_proof(proof)` | Verify a Merkle proof |
| `get_record(index)` / `get_records()` | Access records |
| `export()` | Export `{session, records}` as camelCase dicts |

### Action types

`QUERY`, `UPDATE`, `CREATE`, `DELETE`, `DECISION`, `ESCALATION`, `TOOL_CALL`, `CALCULATION`, `VALIDATION` — string values identical to the TypeScript enum.

### Low-level utilities

`sha256`, `hash_action_record`, `combine_hashes`, `sorted_stringify`, `compute_merkle_root`, `generate_merkle_proof`, `verify_merkle_proof`, `verify_chain`, `verify_action_record`, `verify_exported_session`.

## Cross-language equivalence

The hashes are byte-for-byte identical to the TypeScript library because the canonical serialization reproduces JavaScript's `JSON.stringify` exactly, including its number formatting (integer-valued floats such as `149.0` serialize as `149`). See [`CANONICALIZATION.md`](CANONICALIZATION.md) for the details and one documented v1 limitation.

`examples/cross_language/` contains a runnable round-trip: it seals a session in Python, verifies it with the published npm package via Node, and vice versa.

## What it does and does not cover

AgentLedger verifies the integrity of the records submitted to it. It detects changes to recorded actions after sealing and confirms a record belongs to an anchored session. It does not prove that the agent recorded every action that occurred, and it does not independently confirm that recorded values match the underlying operation. Anchoring the sealed root to an independent, externally controlled location is what protects against a privileged actor rewriting both the records and the fingerprint.

## License

MIT. See [LICENSE](LICENSE).

## Author

Vikas Luthra.
