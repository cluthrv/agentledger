"""
Session manager (Python port of ``src/core/session.ts``).

``AgentLedgerSession`` is the primary interface: create a session, record
actions, seal with a Merkle root, verify, and generate/verify Merkle proofs.
Method names are Pythonic (snake_case); semantics match the TypeScript class.

Pass ``canonicalization="v2"`` to hash records over every nested field (such
as tool arguments) and seal with the RFC 6962 style Merkle tree. v1 stays the
default, so existing sessions hash and verify as before.

Records are stored as plain-JSON copies and handed out as copies: changing an
object after recording it, or changing a record you got back, does not affect
the session.
"""

from __future__ import annotations

import copy
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from .merkle import (
    MerkleProof,
    compute_merkle_root,
    compute_merkle_root_v2,
    generate_merkle_proof,
    generate_merkle_proof_v2,
    verify_merkle_proof,
    verify_merkle_proof_v2,
)
from .normalize import to_json_value
from .recorder import HASH_VERSIONS, create_action_record, verify_chain
from .types import (
    ActionRecord,
    ActionRecordInput,
    ActionType,
    AuditSession,
    SessionStatus,
    VerificationCheck,
    VerificationResult,
)


def _now_iso() -> str:
    now = datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


class AgentLedgerSession:
    def __init__(
        self,
        agent_id: str,
        initiator: Optional[str] = None,
        platform: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        canonicalization: str = "v1",
    ) -> None:
        if canonicalization not in HASH_VERSIONS:
            raise ValueError(
                f"unknown canonicalization {canonicalization!r}; expected 'v1' or 'v2'"
            )
        self._version = canonicalization
        self._session_id = str(uuid.uuid4())
        self._agent_id = agent_id
        self._start_time = _now_iso()
        self._initiator = initiator
        self._platform = platform
        self._session_metadata = to_json_value(metadata) if metadata is not None else None
        self._records: List[ActionRecord] = []
        self._status: SessionStatus = SessionStatus.ACTIVE
        self._merkle_root: Optional[str] = None
        self._end_time: Optional[str] = None

    def record(
        self,
        action_type: ActionType,
        input: Optional[Dict[str, Any]] = None,
        output: Optional[Dict[str, Any]] = None,
        reasoning: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        agent_id: Optional[str] = None,
    ) -> ActionRecord:
        """Record an agent action and chain it. Raises if the session is sealed.

        ``agent_id`` defaults to the session's agent id when not given.
        ``input``, ``output`` and ``metadata`` are copied as plain JSON; values
        that JSON cannot hold raise, naming where they are. Returns a copy of
        the stored record.
        """
        if self._status != SessionStatus.ACTIVE:
            raise RuntimeError(
                f"Cannot record actions in a {self._status.value} session. "
                f"Sessions are immutable once sealed."
            )

        sequence_number = len(self._records)
        previous_hash = (
            self._records[sequence_number - 1].hash if sequence_number > 0 else None
        )

        data = ActionRecordInput(
            agent_id=agent_id if agent_id is not None else self._agent_id,
            action_type=action_type,
            input=input if input is not None else {},
            output=output if output is not None else {},
            reasoning=reasoning,
            metadata=metadata,
        )
        rec = create_action_record(
            self._session_id, data, sequence_number, previous_hash, self._version
        )
        self._records.append(rec)
        return copy.deepcopy(rec)

    def seal(self) -> AuditSession:
        """Compute the Merkle root and transition to SEALED."""
        if self._status != SessionStatus.ACTIVE:
            raise RuntimeError("Session is already sealed.")
        if not self._records:
            raise RuntimeError(
                "Cannot seal an empty session. Record at least one action first."
            )

        hashes = [r.hash for r in self._records]
        self._merkle_root = self._root(hashes)
        self._end_time = _now_iso()
        self._status = SessionStatus.SEALED
        return self.to_audit_session()

    def verify(self) -> VerificationResult:
        """Verify chain integrity, the Merkle root (if sealed), and record count."""
        checks: List[VerificationCheck] = []

        valid, errors = verify_chain(self._records, self._version)
        checks.append(
            VerificationCheck(
                name="hash_chain_integrity",
                passed=valid,
                detail=(
                    f"All {len(self._records)} records have valid hashes and chain linkage"
                    if valid
                    else "; ".join(errors)
                ),
            )
        )

        if self._status in (SessionStatus.SEALED, SessionStatus.VERIFIED) and self._merkle_root:
            recomputed = self._root([r.hash for r in self._records])
            root_valid = recomputed == self._merkle_root
            checks.append(
                VerificationCheck(
                    name="merkle_root_integrity",
                    passed=root_valid,
                    detail=(
                        f"Merkle root verified: {self._merkle_root[:16]}..."
                        if root_valid
                        else f"Merkle root mismatch: stored {self._merkle_root[:16]}... "
                        f"vs computed {(recomputed or '')[:16]}..."
                    ),
                )
            )

        count_valid = len(self._records) > 0
        checks.append(
            VerificationCheck(
                name="record_count",
                passed=count_valid,
                detail=f"Session contains {len(self._records)} record(s)",
            )
        )

        all_passed = all(c.passed for c in checks)
        if all_passed and self._status == SessionStatus.SEALED:
            self._status = SessionStatus.VERIFIED

        return VerificationResult(
            valid=all_passed,
            message=(
                f"Session {self._session_id} verified successfully. "
                f"{len(self._records)} records, chain intact."
                if all_passed
                else f"Session {self._session_id} verification FAILED. See checks for details."
            ),
            checks=checks,
        )

    def prove_record(self, record_index: int) -> Optional[MerkleProof]:
        """Generate a Merkle proof for one record. Requires a sealed session."""
        if self._status == SessionStatus.ACTIVE:
            raise RuntimeError(
                "Cannot generate proofs for an active session. Seal the session first."
            )
        hashes = [r.hash for r in self._records]
        if self._version == "v2":
            return generate_merkle_proof_v2(hashes, record_index)
        return generate_merkle_proof(hashes, record_index)

    def verify_proof(self, proof: MerkleProof) -> bool:
        """Verify a proof made by this session (v1 or v2, as the session hashes)."""
        if self._version == "v2":
            return verify_merkle_proof_v2(proof)
        return verify_merkle_proof(proof)

    def get_record(self, index: int) -> Optional[ActionRecord]:
        """A copy of one record, or None if the index is out of range."""
        if 0 <= index < len(self._records):
            return copy.deepcopy(self._records[index])
        return None

    def get_records(self) -> List[ActionRecord]:
        """Copies of all records."""
        return copy.deepcopy(self._records)

    def get_hash_version(self) -> str:
        """The hashing version this session uses: "v1" or "v2"."""
        return self._version

    def _root(self, hashes: List[str]) -> Optional[str]:
        if self._version == "v2":
            return compute_merkle_root_v2(hashes)
        return compute_merkle_root(hashes)

    def to_audit_session(self) -> AuditSession:
        return AuditSession(
            session_id=self._session_id,
            agent_id=self._agent_id,
            start_time=self._start_time,
            end_time=self._end_time,
            record_count=len(self._records),
            merkle_root=self._merkle_root,
            status=self._status,
            initiator=self._initiator,
            platform=self._platform,
            metadata=copy.deepcopy(self._session_metadata),
            canonicalization="v2" if self._version == "v2" else None,
            merkle="v2" if self._version == "v2" else None,
        )

    def get_session_id(self) -> str:
        return self._session_id

    def get_status(self) -> SessionStatus:
        return self._status

    def export(self) -> Dict[str, Any]:
        """Export the session summary and all records as camelCase dicts.

        The result is a fresh copy, in the shape the TypeScript ``export()``
        produces; a v2 session carries ``canonicalization`` and ``merkle``
        ("v2") in its summary. Write it with ``json.dump`` and check it later
        with ``verify_exported_session``.
        """
        return copy.deepcopy(
            {
                "session": self.to_audit_session().to_dict(),
                "records": [r.to_dict() for r in self._records],
            }
        )
