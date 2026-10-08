"""
AgentLedger type definitions (Python port of ``src/types/index.ts``).

Enum string values are identical to the TypeScript library, and the
``to_dict``/``from_dict`` helpers emit and read the same camelCase JSON shape,
so records and sessions round-trip across the two implementations.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


class ActionType(str, Enum):
    """Types of actions an AI agent can perform. Values match the TS enum."""

    QUERY = "query"
    UPDATE = "update"
    CREATE = "create"
    DELETE = "delete"
    DECISION = "decision"
    ESCALATION = "escalation"
    TOOL_CALL = "tool_call"
    CALCULATION = "calculation"
    VALIDATION = "validation"


class SessionStatus(str, Enum):
    """Lifecycle states of an audit session."""

    ACTIVE = "active"
    SEALED = "sealed"
    VERIFIED = "verified"


@dataclass
class ActionRecordInput:
    """What the caller provides; AgentLedger computes the rest."""

    agent_id: Optional[str]
    action_type: ActionType
    input: Dict[str, Any] = field(default_factory=dict)
    output: Dict[str, Any] = field(default_factory=dict)
    reasoning: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


@dataclass
class ActionRecord:
    """A complete, immutable Action Record with computed cryptographic fields."""

    id: str
    session_id: str
    sequence_number: int
    timestamp: str
    agent_id: Optional[str]
    action_type: ActionType
    input: Dict[str, Any]
    output: Dict[str, Any]
    hash: str
    previous_hash: Optional[str]
    reasoning: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        """Serialize to the camelCase JSON shape used by the TS library.

        Optional fields (reasoning, metadata) are omitted when absent, which
        matches how the TypeScript records serialize and is required for the
        hashes to line up on a round-trip.
        """
        d: Dict[str, Any] = {
            "id": self.id,
            "sessionId": self.session_id,
            "sequenceNumber": self.sequence_number,
            "timestamp": self.timestamp,
            "actionType": _enum_value(self.action_type),
            "input": self.input,
            "output": self.output,
            "hash": self.hash,
            "previousHash": self.previous_hash,
        }
        if self.agent_id is not None:
            d["agentId"] = self.agent_id
        if self.reasoning is not None:
            d["reasoning"] = self.reasoning
        if self.metadata is not None:
            d["metadata"] = self.metadata
        return d

    @staticmethod
    def from_dict(d: Dict[str, Any]) -> "ActionRecord":
        return ActionRecord(
            id=d["id"],
            session_id=d["sessionId"],
            sequence_number=d["sequenceNumber"],
            timestamp=d["timestamp"],
            agent_id=d.get("agentId"),
            action_type=ActionType(d["actionType"]),
            input=d.get("input", {}),
            output=d.get("output", {}),
            reasoning=d.get("reasoning"),
            metadata=d.get("metadata"),
            hash=d["hash"],
            previous_hash=d.get("previousHash"),
        )


@dataclass
class AuditSession:
    """A session summary, matching the TS ``AuditSession`` shape."""

    session_id: str
    agent_id: str
    start_time: str
    end_time: Optional[str]
    record_count: int
    merkle_root: Optional[str]
    status: SessionStatus
    initiator: Optional[str] = None
    platform: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "sessionId": self.session_id,
            "agentId": self.agent_id,
            "startTime": self.start_time,
            "endTime": self.end_time,
            "recordCount": self.record_count,
            "merkleRoot": self.merkle_root,
            "status": _enum_value(self.status),
            "initiator": self.initiator,
            "platform": self.platform,
            "metadata": self.metadata,
        }


@dataclass
class VerificationCheck:
    name: str
    passed: bool
    detail: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {"name": self.name, "passed": self.passed, "detail": self.detail}


@dataclass
class VerificationResult:
    valid: bool
    message: str
    checks: List[VerificationCheck] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "valid": self.valid,
            "message": self.message,
            "checks": [c.to_dict() for c in self.checks],
        }


def _enum_value(v: Any) -> Any:
    return v.value if isinstance(v, Enum) else v
