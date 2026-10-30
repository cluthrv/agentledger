"""
Action recorder (Python port of ``src/core/recorder.ts``).

Creates Action Records, chains them by hash, and verifies record and chain
integrity with the same rules as the TypeScript library.

Every function takes a hashing ``version``: ``"v1"`` (the default, compatible
with 0.1.x) or ``"v2"`` (record hashes cover every nested field; see
CANONICALIZATION.md).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Callable, List, Optional, Tuple

from .hashing import hash_action_record, hash_action_record_v2
from .normalize import to_json_value
from .types import ActionRecord, ActionRecordInput

HASH_VERSIONS = ("v1", "v2")


def _now_iso() -> str:
    """UTC timestamp formatted like JavaScript's ``Date.toISOString()``.

    Produces millisecond precision with a trailing 'Z', e.g.
    ``2026-09-20T01:41:45.817Z``.
    """
    now = datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


def _check_version(version: str) -> None:
    if version not in HASH_VERSIONS:
        raise ValueError(f"unknown hash version {version!r}; expected 'v1' or 'v2'")


def record_hasher(version: str = "v1") -> Callable[..., str]:
    """The record hash function for a hashing version."""
    _check_version(version)
    return hash_action_record_v2 if version == "v2" else hash_action_record


def create_action_record(
    session_id: str,
    data: ActionRecordInput,
    sequence_number: int,
    previous_hash: Optional[str],
    version: str = "v1",
) -> ActionRecord:
    """Create a new Action Record, compute its hash, and chain it.

    ``input``, ``output`` and ``metadata`` are stored as plain-JSON copies (see
    ``normalize.py``), so the record holds exactly what was hashed and later
    changes to the caller's objects do not affect it. Under v2, NaN and
    Infinity are rejected rather than stored as None.
    """
    hasher = record_hasher(version)
    strict = version == "v2"

    def copy(value: Any, name: str) -> Any:
        try:
            return to_json_value(value, strict_numbers=strict)
        except (TypeError, ValueError) as e:
            raise type(e)(f"{name}: {e}") from None

    input_ = copy(data.input if data.input is not None else {}, "input")
    output = copy(data.output if data.output is not None else {}, "output")
    metadata = copy(data.metadata, "metadata") if data.metadata is not None else None
    reasoning = None if data.reasoning is None else str(data.reasoning)
    agent_id = None if data.agent_id is None else str(data.agent_id)

    record_id = str(uuid.uuid4())
    timestamp = _now_iso()

    h = hasher(
        id=record_id,
        session_id=session_id,
        sequence_number=sequence_number,
        timestamp=timestamp,
        agent_id=agent_id,
        action_type=_av(data.action_type),
        input=input_,
        output=output,
        reasoning=reasoning,
        metadata=metadata,
        previous_hash=previous_hash,
    )

    return ActionRecord(
        id=record_id,
        session_id=session_id,
        sequence_number=sequence_number,
        timestamp=timestamp,
        agent_id=agent_id,
        action_type=data.action_type,
        input=input_,
        output=output,
        reasoning=reasoning,
        metadata=metadata,
        hash=h,
        previous_hash=previous_hash,
    )


def verify_action_record(record: ActionRecord, version: str = "v1") -> bool:
    """Recompute a record's hash from its fields and compare to the stored one."""
    try:
        recomputed = record_hasher(version)(
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
    except (TypeError, ValueError):
        return False  # content that cannot be hashed cannot match
    return recomputed == record.hash


def verify_chain(records: List[ActionRecord], version: str = "v1") -> Tuple[bool, List[str]]:
    """
    Verify an entire chain. Checks, in order:
      1. first record has null previous_hash and sequence 0
      2. sequence numbers are contiguous from 0
      3. each record's content matches its hash
      4. each record's previous_hash matches the prior record's hash

    Returns ``(valid, errors)``.
    """
    _check_version(version)
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
        if not verify_action_record(record, version):
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
