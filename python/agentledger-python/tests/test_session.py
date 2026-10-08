"""Lifecycle, chain, proof and tamper tests mirroring the TS suite."""

import pytest

from agentledger import (
    ActionType,
    AgentLedgerSession,
    SessionStatus,
    verify_chain,
)


def _three_step_session():
    s = AgentLedgerSession(agent_id="pricing-agent", platform="mcp")
    s.record(action_type=ActionType.QUERY, input={"q": "tier"}, output={"tier": "Gold"},
             reasoning="lookup")
    s.record(action_type=ActionType.CALCULATION, input={"base": 200, "pct": 15},
             output={"final": 170}, reasoning="discount")
    s.record(action_type=ActionType.CREATE, input={"acct": "ACC-100", "price": 170},
             output={"quoteId": "Q-1", "status": "draft"}, reasoning="quote")
    return s


def test_record_chains_previous_hash():
    s = _three_step_session()
    recs = s.get_records()
    assert recs[0].previous_hash is None
    assert recs[1].previous_hash == recs[0].hash
    assert recs[2].previous_hash == recs[1].hash


def test_seal_and_verify_passes():
    s = _three_step_session()
    sealed = s.seal()
    assert sealed.merkle_root is not None
    result = s.verify()
    assert result.valid
    assert s.get_status() == SessionStatus.VERIFIED


def test_cannot_record_after_seal():
    s = _three_step_session()
    s.seal()
    with pytest.raises(RuntimeError):
        s.record(action_type=ActionType.QUERY)


def test_cannot_seal_empty():
    s = AgentLedgerSession(agent_id="a")
    with pytest.raises(RuntimeError):
        s.seal()


def test_cannot_prove_active_session():
    s = _three_step_session()
    with pytest.raises(RuntimeError):
        s.prove_record(0)


def test_proofs_round_trip_every_record():
    s = _three_step_session()
    s.seal()
    for i in range(3):
        proof = s.prove_record(i)
        assert proof is not None
        assert s.verify_proof(proof)


def test_tamper_breaks_verification():
    s = _three_step_session()
    s.seal()
    # Mutate a sealed record's content in place (simulating post-seal tamper).
    s.get_records()[1].output["final"] = 999
    # get_records returns copies, so mutate the internal list directly:
    s._records[1].output["final"] = 999  # type: ignore[attr-defined]
    valid, errors = verify_chain(s.get_records())
    assert not valid
    assert any("record 1" in e.lower() or "record 1 " in e.lower() or "(1" in e.lower()
               or "Record 1" in e for e in errors)


def test_export_shape_is_camelcase():
    s = _three_step_session()
    s.seal()
    exported = s.export()
    assert set(["session", "records"]).issubset(exported.keys())
    r0 = exported["records"][0]
    assert "sessionId" in r0 and "sequenceNumber" in r0 and "previousHash" in r0
    assert exported["session"]["merkleRoot"] is not None
