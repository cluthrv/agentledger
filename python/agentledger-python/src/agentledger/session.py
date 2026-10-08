"""
Session manager (Python port of ``src/core/session.ts``).

``AgentLedgerSession`` is the primary interface: create a session, record
actions, seal with a Merkle root, verify, and generate/verify Merkle proofs.
Method names are Pythonic (snake_case); semantics match the TypeScript class.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from .merkle import (
    MerkleProof,
    compute_merkle_root,
    generate_merkle_proof,
    verify_merkle_proof,
)
from .recorder import create_action_record, verify_chain
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
    ) -> None:
        self._session_id = str(uuid.uuid4())
        self._agent_id = agent_id
        self._start_time = _now_iso()
        self._initiator = initiator
        self._platform = platform
        self._session_metadata = metadata
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
        rec = create_action_record(self._session_id, data, sequence_number, previous_hash)
        self._records.append(rec)
        return rec

    def seal(self) -> AuditSession:
        """Compute the Merkle root and transition to SEALED."""
        if self._status != SessionStatus.ACTIVE:
            raise RuntimeError("Session is already sealed.")
        if not self._records:
            raise RuntimeError(
                "Cannot seal an empty session. Record at least one action first."
            )

        hashes = [r.hash for r in self._records]
        self._merkle_root = compute_merkle_root(hashes)
        self._end_time = _now_iso()
        self._status = SessionStatus.SEALED
        return self.to_audit_session()

    def verify(self) -> VerificationResult:
        """Verify chain integrity, the Merkle root (if sealed), and record count."""
        checks: List[VerificationCheck] = []

        valid, errors = verify_chain(self._records)
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
            recomputed = compute_merkle_root([r.hash for r in self._records])
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
        return generate_merkle_proof([r.hash for r in self._records], record_index)

    def verify_proof(self, proof: MerkleProof) -> bool:
        return verify_merkle_proof(proof)

    def get_record(self, index: int) -> Optional[ActionRecord]:
        if 0 <= index < len(self._records):
            return self._records[index]
        return None

    def get_records(self) -> List[ActionRecord]:
        return list(self._records)

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
            metadata=self._session_metadata,
        )

    def get_session_id(self) -> str:
        return self._session_id

    def get_status(self) -> SessionStatus:
        return self._status

    def export(self) -> Dict[str, Any]:
        """Export the session summary and all records as camelCase dicts."""
        return {
            "session": self.to_audit_session().to_dict(),
            "records": [r.to_dict() for r in self._records],
        }
