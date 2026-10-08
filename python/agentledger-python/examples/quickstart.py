"""Minimal AgentLedger example: record, seal, verify, prove.

Run from the package root:
    PYTHONPATH=src python examples/quickstart.py
"""

from agentledger import AgentLedgerSession, ActionType


def main() -> None:
    session = AgentLedgerSession(agent_id="sales-ops-agent", platform="mcp")

    session.record(
        action_type=ActionType.TOOL_CALL,
        input={"tool": "get_credit_score", "args": {"customerId": "MER-100"}},
        output={"score": 580, "previousQuarter": 690},
        metadata={"system": "bureau", "trustDomain": "external:credit-bureau"},
    )
    session.record(
        action_type=ActionType.DECISION,
        reasoning="Score 580 is below the 650 threshold; recommend DECLINE.",
    )

    sealed = session.seal()
    print(f"sealed {sealed.record_count} records")
    print(f"merkle root: {sealed.merkle_root}")

    result = session.verify()
    print(f"verify.valid: {result.valid}")
    for c in result.checks:
        print(f"  - {c.name}: {'PASS' if c.passed else 'FAIL'} ({c.detail})")

    proof = session.prove_record(0)
    print(f"proof for record 0 verifies: {session.verify_proof(proof)}")


if __name__ == "__main__":
    main()
