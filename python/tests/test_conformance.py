"""
Cross-language conformance.

These tests are the whole point of the port: they prove the Python
implementation reproduces the exact record hashes and Merkle roots produced by
the TypeScript library, using real sessions that were sealed by the TS/MCP
stack and anchored to Arbitrum Sepolia.

Fixtures
--------
session_658ad5e3.json : a clean sealed+anchored session. Every record's content
    must match its stored hash, and the recomputed Merkle root must equal both
    the stored root and the on-chain anchor.

session_907b4980.json : the same workflow, but record 6's output was altered
    after sealing (a naive tamper: output {} -> {"score": 720}, hash left
    unchanged). The anchored root still matches (it is computed over the stored
    hash fields), but record 6's content no longer matches its own hash. Python
    must detect exactly that, identically to the TS library.
"""

import json
import os

import pytest

from agentledger import (
    compute_merkle_root,
    generate_merkle_proof,
    verify_exported_session,
    verify_merkle_proof,
)
from agentledger.recorder import verify_action_record
from agentledger.types import ActionRecord

FIX = os.path.join(os.path.dirname(__file__), "fixtures")


def _load(name):
    with open(os.path.join(FIX, name), "r", encoding="utf-8") as f:
        return json.load(f)


def _records(doc):
    return [ActionRecord.from_dict(r) for r in doc["records"]]


# ---------------------------------------------------------------------------
# Clean session: 658ad5e3
# ---------------------------------------------------------------------------

def test_clean_every_record_hash_reproduced():
    doc = _load("session_658ad5e3.json")
    for rec in _records(doc):
        assert verify_action_record(rec), f"record {rec.sequence_number} hash mismatch"


def test_clean_merkle_root_matches_stored_and_anchor():
    doc = _load("session_658ad5e3.json")
    root = compute_merkle_root([r.hash for r in _records(doc)])
    assert root == doc["session"]["merkleRoot"]
    anchored = doc["anchor"]["root"]
    anchored = anchored[2:] if anchored.startswith("0x") else anchored
    assert root.lower() == anchored.lower()


def test_clean_full_verification_passes():
    doc = _load("session_658ad5e3.json")
    result = verify_exported_session(doc)
    assert result.valid, result.message
    names = {c.name: c.passed for c in result.checks}
    assert names["hash_chain_integrity"]
    assert names["merkle_root_integrity"]
    assert names["anchored_root_match"]


def test_clean_proofs_round_trip_for_every_record():
    doc = _load("session_658ad5e3.json")
    hashes = [r.hash for r in _records(doc)]
    root = compute_merkle_root(hashes)
    for i in range(len(hashes)):
        proof = generate_merkle_proof(hashes, i)
        assert proof is not None
        assert proof.root == root
        assert verify_merkle_proof(proof), f"proof for record {i} failed"


def test_clean_tampered_proof_is_rejected():
    doc = _load("session_658ad5e3.json")
    hashes = [r.hash for r in _records(doc)]
    proof = generate_merkle_proof(hashes, 5)
    # Flip the leaf: a proof for a different record hash must not verify.
    proof.record_hash = "0" * 64
    assert not verify_merkle_proof(proof)


# ---------------------------------------------------------------------------
# Tampered session: 907b4980
# ---------------------------------------------------------------------------

def test_tampered_record6_content_does_not_match_its_hash():
    doc = _load("session_907b4980.json")
    recs = _records(doc)
    bad = [r.sequence_number for r in recs if not verify_action_record(r)]
    assert bad == [6], f"expected only record 6 to fail, got {bad}"
    # The injected field is the tell.
    assert recs[6].output == {"score": 720}


def test_tampered_anchor_root_still_matches_but_verification_fails():
    doc = _load("session_907b4980.json")
    # Root over the STORED hash fields equals the anchor (seal() hashed these).
    root = compute_merkle_root([r.hash for r in _records(doc)])
    anchored = doc["anchor"]["root"]
    anchored = anchored[2:] if anchored.startswith("0x") else anchored
    assert root.lower() == anchored.lower()
    # But full verification fails on the content-integrity check.
    result = verify_exported_session(doc)
    assert not result.valid
    names = {c.name: c.passed for c in result.checks}
    assert names["hash_chain_integrity"] is False
    assert names["anchored_root_match"] is True


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
