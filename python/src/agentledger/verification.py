"""
Standalone verification helpers for sessions exported by either the TypeScript
or Python implementation.

These let an auditor verify a sealed session (the ``{session, records, anchor}``
JSON shape) without reconstructing an ``AgentLedgerSession`` object. This is the
cross-language entry point: feed it a session produced by the TS library and it
confirms the record hashes and Merkle root independently in Python.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from .merkle import compute_merkle_root
from .recorder import verify_chain
from .types import ActionRecord, VerificationCheck, VerificationResult


def load_records(doc: Dict[str, Any]) -> List[ActionRecord]:
    """Build ActionRecord objects from an exported session document."""
    return [ActionRecord.from_dict(r) for r in doc.get("records", [])]


def verify_exported_session(doc: Dict[str, Any]) -> VerificationResult:
    """
    Verify an exported session document.

    Runs the same three checks as ``AgentLedgerSession.verify`` against the
    stored records, plus, when an ``anchor`` block is present, an independent
    check that the recomputed Merkle root matches the anchored root (the
    0x-prefixed on-chain value is normalized before comparison).
    """
    records = load_records(doc)
    checks: List[VerificationCheck] = []

    valid, errors = verify_chain(records)
    checks.append(
        VerificationCheck(
            name="hash_chain_integrity",
            passed=valid,
            detail=(
                f"All {len(records)} records have valid hashes and chain linkage"
                if valid
                else "; ".join(errors)
            ),
        )
    )

    stored_root: Optional[str] = (doc.get("session") or {}).get("merkleRoot")
    recomputed_root = compute_merkle_root([r.hash for r in records])
    root_ok = stored_root is not None and recomputed_root == stored_root
    checks.append(
        VerificationCheck(
            name="merkle_root_integrity",
            passed=root_ok,
            detail=(
                f"Merkle root verified: {(recomputed_root or '')[:16]}..."
                if root_ok
                else f"Merkle root mismatch: stored {(stored_root or '')[:16]}... "
                f"vs computed {(recomputed_root or '')[:16]}..."
            ),
        )
    )

    anchor = doc.get("anchor")
    if anchor and anchor.get("root"):
        anchored = _strip0x(anchor["root"]).lower()
        anchored_ok = recomputed_root is not None and recomputed_root.lower() == anchored
        checks.append(
            VerificationCheck(
                name="anchored_root_match",
                passed=anchored_ok,
                detail=(
                    f"Recomputed root matches anchor on {anchor.get('chain', 'external ledger')}"
                    if anchored_ok
                    else f"Recomputed root does NOT match anchored root {anchored[:16]}..."
                ),
            )
        )

    all_passed = all(c.passed for c in checks)
    session_id = (doc.get("session") or {}).get("sessionId", "?")
    return VerificationResult(
        valid=all_passed,
        message=(
            f"Session {session_id} verified successfully."
            if all_passed
            else f"Session {session_id} verification FAILED. See checks for details."
        ),
        checks=checks,
    )


def _strip0x(value: str) -> str:
    return value[2:] if value.startswith("0x") else value
