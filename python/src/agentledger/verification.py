"""
Standalone verification helpers for sessions exported by either the TypeScript
or Python implementation.

These let an auditor verify a sealed session (the ``{session, records, anchor}``
JSON shape) without reconstructing an ``AgentLedgerSession`` object. This is the
cross-language entry point: feed it a session produced by the TS library and it
confirms the record hashes and Merkle root independently in Python.

The ``anchor`` block inside a session document is a cached copy: whoever can
edit the records can edit it too. Pass ``onchain=OnChainAnchor(...)`` to read the
anchored root from the chain itself (the AnchorRegistry contract in
``mcp-demo/contracts``), keyed by session id and a trusted anchorer address that
comes from your configuration, not from the document.

A document says how it was hashed: ``"canonicalization": "v2"`` and
``"merkle": "v2"``, inside ``session`` (as ``export()`` in either library writes
them) or at the top level (as the MCP demo writes them), for sessions recorded
with v2 (record hashes over canonical
JSON of every nested field; RFC 6962 style Merkle tree), both absent for v1.
v1 documents verify as before; their record hashes do not cover nested fields
(see CANONICALIZATION.md and SIGNING.md).

Gateway and server signatures (``provenance``, Ed25519) are checked by the
JavaScript verifier in ``mcp-demo``; this module stays dependency-free.
"""

from __future__ import annotations

import json
import urllib.request
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence, Tuple

from .merkle import compute_merkle_root, compute_merkle_root_v2
from .recorder import verify_chain
from .types import ActionRecord, VerificationCheck, VerificationResult


def load_records(doc: Dict[str, Any]) -> List[ActionRecord]:
    """Build ActionRecord objects from an exported session document."""
    return [ActionRecord.from_dict(r) for r in doc.get("records", [])]


def _declared(inner: Optional[str], outer: Optional[str]) -> Optional[str]:
    """One declared version from the session summary and the top level.

    Absent in both means v1; different values in the two places mean None.
    """
    if inner and outer and inner != outer:
        return None
    return inner or outer or "v1"


def _versions(doc: Dict[str, Any]) -> Tuple[Optional[str], Optional[str]]:
    session = doc.get("session") or {}
    return (
        _declared(session.get("canonicalization"), doc.get("canonicalization")),
        _declared(session.get("merkle"), doc.get("merkle")),
    )


# First 4 bytes of keccak256("anchors(address,bytes32)"), the public getter on
# AnchorRegistry. Hardcoded because the stdlib has no keccak (sha3_256 differs).
ANCHORS_SELECTOR = "941b1092"


@dataclass(frozen=True)
class OnChainAnchor:
    """Where to read anchors and whose anchors to trust.

    This must come from the verifier's own configuration, never from the
    session document being verified.
    """

    rpc_url: str
    contract: str
    trusted_anchorers: Sequence[str]
    timeout: float = 10.0


def session_id_to_bytes32(session_id: str) -> str:
    """A UUID session id, left-padded into 32 bytes (64 hex chars, no 0x)."""
    hex_id = session_id.replace("-", "").lower()
    if len(hex_id) != 32 or any(c not in "0123456789abcdef" for c in hex_id):
        raise ValueError(f"session id is not a UUID: {session_id}")
    return hex_id.rjust(64, "0")


def read_onchain_anchor(
    cfg: OnChainAnchor, anchorer: str, session_id: str
) -> Optional[Tuple[str, int]]:
    """Return ``(root_hex, anchored_at)`` anchored by ``anchorer`` for this
    session, or ``None`` if there is no such anchor. Raises on RPC failure."""
    data = (
        "0x"
        + ANCHORS_SELECTOR
        + _strip0x(anchorer).lower().rjust(64, "0")
        + session_id_to_bytes32(session_id)
    )
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "eth_call",
        "params": [{"to": cfg.contract, "data": data}, "latest"],
    }
    req = urllib.request.Request(
        cfg.rpc_url,
        data=json.dumps(payload).encode(),
        headers={"content-type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=cfg.timeout) as resp:
        body = json.loads(resp.read())
    if "error" in body:
        raise RuntimeError(body["error"].get("message", str(body["error"])))
    out = _strip0x(body["result"])
    if len(out) < 128:
        raise RuntimeError(f"unexpected eth_call result: {body['result']!r}")
    root, anchored_at = out[:64], int(out[64:128], 16)
    return None if anchored_at == 0 else (root, anchored_at)


def _check_onchain(
    cfg: OnChainAnchor, session_id: str, recomputed_root: Optional[str]
) -> VerificationCheck:
    name = "anchored_root_onchain"
    if not cfg.trusted_anchorers:
        return VerificationCheck(name, False, "No trusted anchorer configured")
    try:
        for anchorer in cfg.trusted_anchorers:
            found = read_onchain_anchor(cfg, anchorer, session_id)
            if found is None:
                continue
            root, anchored_at = found
            ok = recomputed_root is not None and recomputed_root.lower() == root.lower()
            return VerificationCheck(
                name,
                ok,
                f"Recomputed root matches the root anchored on chain by {anchorer}"
                if ok
                else f"Recomputed root does NOT match the on-chain root {root[:16]}...",
            )
    except Exception as e:  # network, RPC, or decoding failure: fail closed
        return VerificationCheck(name, False, f"Could not read the anchor from chain: {e}")
    return VerificationCheck(
        name, False, f"No anchor for session {session_id} from a trusted anchorer"
    )


def verify_exported_session(
    doc: Dict[str, Any], onchain: Optional[OnChainAnchor] = None
) -> VerificationResult:
    """
    Verify an exported session document.

    Runs the same checks as ``verifyExportedSession`` in the TypeScript
    library: ``hash_version``, ``hash_chain_integrity``, ``session_consistency``
    and, when the session was sealed, ``merkle_root_integrity``. When an
    ``anchor`` block is present it also checks that the recomputed Merkle root
    matches the root cached in that block (the 0x-prefixed on-chain value is
    normalized before comparison).

    The cached block is not independent of the records. Pass ``onchain`` to add
    ``anchored_root_onchain``, which reads the root from the chain itself.
    """
    session = doc.get("session") if isinstance(doc, dict) else None
    raw_records = doc.get("records") if isinstance(doc, dict) else None
    try:
        if not isinstance(session, dict) or not isinstance(raw_records, list):
            raise ValueError("expected { session, records }")
        records = load_records(doc)
    except (KeyError, TypeError, ValueError, AttributeError) as e:
        return VerificationResult(
            valid=False,
            message="Not an exported session: expected { session, records }.",
            checks=[VerificationCheck("document_shape", False, f"{type(e).__name__}: {e}")],
        )

    checks: List[VerificationCheck] = []
    session_id = session.get("sessionId", "?")

    # 1. Hashing version, declared consistently.
    canonicalization, merkle = _versions(doc)
    version_ok = canonicalization in ("v1", "v2") and merkle == canonicalization
    checks.append(
        VerificationCheck(
            name="hash_version",
            passed=version_ok,
            detail=(
                (
                    "v2: record hashes cover every field, nested ones included"
                    if canonicalization == "v2"
                    else "v1: nested fields such as tool arguments are not covered by the record hash"
                )
                if version_ok
                else f"Unsupported or conflicting versions: canonicalization "
                f"{canonicalization or 'conflicting'}, merkle {merkle or 'conflicting'}"
            ),
        )
    )
    version = "v2" if canonicalization == "v2" else "v1"
    v2 = version == "v2"

    # 2. Record hashes and chain linkage.
    valid, errors = verify_chain(records, version)
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

    # 3. The records belong to this session, and all of them are present.
    foreign = next((i for i, r in enumerate(records) if r.session_id != session_id), None)
    stated = session.get("recordCount")
    count_ok = len(records) > 0 and len(records) == stated
    checks.append(
        VerificationCheck(
            name="session_consistency",
            passed=foreign is None and count_ok,
            detail=(
                f"record {foreign} belongs to session {records[foreign].session_id}, not {session_id}"
                if foreign is not None
                else f"{len(records)} record(s), as the session summary states"
                if count_ok
                else f"{len(records)} record(s), but the session summary states {stated}"
            ),
        )
    )

    # 4. The Merkle root, when the session was sealed.
    stored_root: Optional[str] = session.get("merkleRoot")
    hashes = [r.hash for r in records]
    recomputed_root = compute_merkle_root_v2(hashes) if v2 else compute_merkle_root(hashes)
    anchor_root = recomputed_root
    if stored_root:
        root_ok = recomputed_root == stored_root
        checks.append(
            VerificationCheck(
                name="merkle_root_integrity",
                passed=root_ok,
                detail=(
                    f"Merkle root verified: {stored_root[:16]}..."
                    if root_ok
                    else f"Merkle root mismatch: stored {stored_root[:16]}... "
                    f"vs computed {(recomputed_root or '')[:16]}..."
                ),
            )
        )

    anchor = doc.get("anchor")
    if anchor and anchor.get("root"):
        anchored = _strip0x(anchor["root"]).lower()
        anchored_ok = anchor_root is not None and anchor_root.lower() == anchored
        checks.append(
            VerificationCheck(
                name="anchored_root_match",
                passed=anchored_ok,
                detail=(
                    f"Recomputed root matches the anchor cached in the document "
                    f"({anchor.get('chain', 'external ledger')}); not independent"
                    if anchored_ok
                    else f"Recomputed root does NOT match anchored root {anchored[:16]}..."
                ),
            )
        )

    if onchain is not None:
        checks.append(_check_onchain(onchain, session.get("sessionId", ""), anchor_root))

    all_passed = all(c.passed for c in checks)
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
