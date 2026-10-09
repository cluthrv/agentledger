"""
AgentLedger (Python)

Cryptographic audit trails for AI agent operations, using SHA-256 hash chains
and Merkle trees. A faithful v1 port of the TypeScript library
(``@vluthra/agent-ledger``): it produces identical record hashes and Merkle
roots, so sessions sealed by one implementation verify under the other.

Example
-------
    from agentledger import AgentLedgerSession, ActionType

    session = AgentLedgerSession(agent_id="pricing-agent")
    session.record(
        action_type=ActionType.QUERY,
        input={"query": "Get dealer pricing for SKU-1234"},
        output={"price": 149.99, "currency": "USD"},
        reasoning="Retrieved base price from CPQ price book",
    )
    sealed = session.seal()
    result = session.verify()
    assert result.valid
"""

from .hashing import combine_hashes, hash_action_record, sha256, sorted_stringify
from .merkle import (
    MerkleProof,
    MerkleSibling,
    compute_merkle_root,
    generate_merkle_proof,
    verify_merkle_proof,
)
from .recorder import create_action_record, verify_action_record, verify_chain
from .session import AgentLedgerSession
from .types import (
    ActionRecord,
    ActionRecordInput,
    ActionType,
    AuditSession,
    SessionStatus,
    VerificationCheck,
    VerificationResult,
)
from .verification import (
    OnChainAnchor,
    load_records,
    read_onchain_anchor,
    session_id_to_bytes32,
    verify_exported_session,
)

__version__ = "0.1.0"

__all__ = [
    "AgentLedgerSession",
    "ActionType",
    "SessionStatus",
    "ActionRecord",
    "ActionRecordInput",
    "AuditSession",
    "VerificationResult",
    "VerificationCheck",
    "MerkleProof",
    "MerkleSibling",
    "sha256",
    "hash_action_record",
    "combine_hashes",
    "sorted_stringify",
    "create_action_record",
    "verify_action_record",
    "verify_chain",
    "compute_merkle_root",
    "generate_merkle_proof",
    "verify_merkle_proof",
    "verify_exported_session",
    "OnChainAnchor",
    "read_onchain_anchor",
    "session_id_to_bytes32",
    "load_records",
    "__version__",
]
