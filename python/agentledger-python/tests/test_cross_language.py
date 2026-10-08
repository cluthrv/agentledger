"""
TypeScript -> Python cross-language verification.

``ts_golden_session.json`` was produced by the published TypeScript package
``@vluthra/agent-ledger`` (via Node), including integer-valued floats, a
repeating decimal, and exponent-notation numbers. Python must reproduce every
record hash and the Merkle root with no help from Node.

The reverse direction (Python -> TypeScript) is exercised by
``examples/cross_language/`` and is not run here because the Python test suite
must not depend on a Node toolchain.
"""

import json
import os

from agentledger import compute_merkle_root, verify_exported_session
from agentledger.recorder import verify_action_record
from agentledger.types import ActionRecord

FIX = os.path.join(os.path.dirname(__file__), "fixtures")


def _load(name):
    with open(os.path.join(FIX, name), "r", encoding="utf-8") as f:
        return json.load(f)


def test_python_verifies_ts_created_session():
    doc = _load("ts_golden_session.json")
    recs = [ActionRecord.from_dict(r) for r in doc["records"]]

    # Every TS-produced record hash reproduces in Python.
    for r in recs:
        assert verify_action_record(r), f"record {r.sequence_number} hash mismatch"

    # The Merkle root reproduces.
    root = compute_merkle_root([r.hash for r in recs])
    assert root == doc["session"]["merkleRoot"]

    # Full verification passes.
    result = verify_exported_session(doc)
    assert result.valid, result.message
