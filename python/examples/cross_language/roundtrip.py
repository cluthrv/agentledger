"""
Python -> JSON producer for the cross-language round-trip.

Seals a session in Python (with float edge cases) and writes it to
``python_session.json``. Then run ``verify.js`` with the published npm package
to confirm the TypeScript library verifies Python's output:

    PYTHONPATH=../../src python roundtrip.py
    npm install @vluthra/agent-ledger
    node verify.js

For the reverse direction, seal a session with the TypeScript library, export
it, and verify it in Python with ``agentledger.verify_exported_session``.
"""

import json
import os

from agentledger import AgentLedgerSession, ActionType

OUT = os.path.join(os.path.dirname(__file__), "python_session.json")


def main() -> None:
    s = AgentLedgerSession(agent_id="pricing-agent", initiator="xlang", platform="mcp")
    s.record(
        action_type=ActionType.QUERY,
        input={"query": "dealer pricing", "args": {"sku": "SKU-1234", "qty": 200}},
        output={"tier": "Gold", "basePrice": 149.0, "rate": 1 / 3},
        reasoning="base price and tier",
    )
    s.record(
        action_type=ActionType.CALCULATION,
        input={"basePrice": 149.0, "discountPct": 15},
        output={"finalPrice": 126.65, "big": 1e21, "small": 1e-7, "zero": 0.0, "neg": -3.0},
        reasoning="applied discount",
        metadata={"system": "cpq", "trustDomain": "internal:pricing"},
    )
    s.record(
        action_type=ActionType.CREATE,
        input={"accountId": "ACC-100", "price": 126.65},
        output={"quoteId": "Q-5678", "status": "draft"},
        reasoning="draft quote",
    )
    sealed = s.seal()
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(s.export(), f, ensure_ascii=False, indent=2)
    print(f"python self-verify: {s.verify().valid}")
    print(f"merkle root: {sealed.merkle_root}")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
