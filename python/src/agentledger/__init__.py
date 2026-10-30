"""
AgentLedger (Python)

Cryptographic audit trails for AI agent operations, using SHA-256 hash chains
and Merkle trees. A port of the TypeScript library (``@vluthra/agent-ledger``)
that produces identical record hashes and Merkle roots, v1 and v2, so sessions
sealed by one implementation verify under the other.

Pass ``canonicalization="v2"`` to cover nested fields such as tool arguments
in the record hash (v1, the default, does not).

Example
-------
    import json
    from agentledger import AgentLedgerSession, ActionType, verify_exported_session

    session = AgentLedgerSession(agent_id="pricing-agent", canonicalization="v2")
    session.record(
        action_type=ActionType.QUERY,
        input={"query": "Get dealer pricing for SKU-1234"},
        output={"price": 149.99, "currency": "USD"},
        reasoning="Retrieved base price from CPQ price book",
    )
    sealed = session.seal()
    assert session.verify().valid

    # Later, anywhere: check the saved file on its own.
    doc = json.loads(json.dumps(session.export()))
    assert verify_exported_session(doc).valid
"""

from .canonical import canonical_json
from .hashing import (
    RECORD_HASH_V2_TAG,
    combine_hashes,
    hash_action_record,
    hash_action_record_v2,
    hash_record_dict_v2,
    sha256,
    sorted_stringify,
)
from .merkle import (
    MerkleProof,
    MerkleSibling,
    compute_merkle_root,
    compute_merkle_root_v2,
    generate_merkle_proof,
    generate_merkle_proof_v2,
    merkle_leaf_v2,
    merkle_node_v2,
    verify_merkle_proof,
    verify_merkle_proof_v2,
)
from .normalize import to_json_value
from .recorder import (
    HASH_VERSIONS,
    create_action_record,
    record_hasher,
    verify_action_record,
    verify_chain,
)
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

__version__ = "0.2.0"

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
    "record_hasher",
    "HASH_VERSIONS",
    "to_json_value",
    "compute_merkle_root",
    "generate_merkle_proof",
    "verify_merkle_proof",
    "verify_exported_session",
    "canonical_json",
    "RECORD_HASH_V2_TAG",
    "hash_action_record_v2",
    "hash_record_dict_v2",
    "compute_merkle_root_v2",
    "generate_merkle_proof_v2",
    "verify_merkle_proof_v2",
    "merkle_leaf_v2",
    "merkle_node_v2",
    "OnChainAnchor",
    "read_onchain_anchor",
    "session_id_to_bytes32",
    "load_records",
    "__version__",
]
