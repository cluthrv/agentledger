"""
Action recorder (Python port of ``src/core/recorder.ts``).

Creates Action Records, chains them by hash, and verifies record and chain
integrity with the same rules as the TypeScript library.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import List, Optional, Tuple

from .hashing import hash_action_record
from .types import ActionRecord, ActionRecordInput


def _now_iso() -> str:
    """UTC timestamp formatted like JavaScript's ``Date.toISOString()``.

    Produces millisecond precision with a trailing 'Z', e.g.
    ``2026-09-20T01:41:45.817Z``.
    """
    now = datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


def create_action_record(
    session_id: str,
    data: ActionRecordInput,
    sequence_number: int,
    previous_hash: Optional[str],
) -> ActionRecord:
    """Create a new Action Record, compute its hash, and chain it."""
    record_id = str(uuid.uuid4())
    timestamp = _now_iso()

    h = hash_action_record(
        id=record_id,
        session_id=session_id,
        sequence_number=sequence_number,
        timestamp=timestamp,
        agent_id=data.agent_id,
        action_type=_av(data.action_type),
        input=data.input,
        output=data.output,
        reasoning=data.reasoning,
        metadata=data.metadata,
        previous_hash=previous_hash,
    )

    return ActionRecord(
        id=record_id,
        session_id=session_id,
        sequence_number=sequence_number,
        timestamp=timestamp,
        agent_id=data.agent_id,
        action_type=data.action_type,
        input=data.input,
        output=data.output,
        reasoning=data.reasoning,
        metadata=data.metadata,
        hash=h,
        previous_hash=previous_hash,
    )


def verify_action_record(record: ActionRecord) -> bool:
    """Recompute a record's hash from its fields and compare to the stored one."""
    recomputed = hash_action_record(
        id=record.id,
        session_id=record.session_id,
        sequence_number=record.sequence_number,
        timestamp=record.timestamp,
        agent_id=record.agent_id,
        action_type=_av(record.action_type),
        input=record.input,
        output=record.output,
        reasoning=record.reasoning,
        metadata=record.metadata,
        previous_hash=record.previous_hash,
    )
    return recomputed == record.hash


def verify_chain(records: List[ActionRecord]) -> Tuple[bool, List[str]]:
    """
    Verify an entire chain. Checks, in order:
      1. first record has null previous_hash and sequence 0
      2. sequence numbers are contiguous from 0
      3. each record's content matches its hash
      4. each record's previous_hash matches the prior record's hash

    Returns ``(valid, errors)``.
    """
    errors: List[str] = []
    if not records:
        return True, []

    if records[0].previous_hash is not None:
        errors.append("First record must have null previousHash")
    if records[0].sequence_number != 0:
        errors.append(
            f"First record has sequenceNumber {records[0].sequence_number}, expected 0"
        )

    for i, record in enumerate(records):
        if record.sequence_number != i:
            errors.append(
                f"Record {i}: sequenceNumber is {record.sequence_number}, expected {i}"
            )
        if not verify_action_record(record):
            errors.append(
                f"Record {i} ({record.id}): hash verification failed "
                f"— content may have been tampered with"
            )
        if i > 0:
            previous = records[i - 1]
            if record.previous_hash != previous.hash:
                errors.append(
                    f"Record {i} ({record.id}): previousHash does not match hash "
                    f"of record {i - 1} — chain is broken"
                )

    return len(errors) == 0, errors


def _av(action_type) -> str:
    return action_type.value if hasattr(action_type, "value") else action_type
