"""
Parity with the TypeScript library 0.2.0: v2 sessions, plain-JSON copies,
record isolation and verify_exported_session. Mirrors
src/__tests__/robustness.test.ts and the session cases of v2.test.ts.

fixtures/ts_lib_v2_session.json is a session sealed by the TypeScript
library's own export() (fixtures/make_ts_lib_session.js).
"""

from __future__ import annotations

import json
import math
from datetime import datetime, timedelta, timezone
from enum import Enum
from pathlib import Path

import pytest

from agentledger import (
    ActionRecordInput,
    ActionType,
    AgentLedgerSession,
    compute_merkle_root,
    compute_merkle_root_v2,
    create_action_record,
    hash_action_record,
    hash_action_record_v2,
    to_json_value,
    verify_exported_session,
)

FIXTURES = Path(__file__).parent / "fixtures"


def save_and_load(s: AgentLedgerSession) -> dict:
    return json.loads(json.dumps(s.export()))


def failed(doc: dict) -> list:
    return [c.name for c in verify_exported_session(doc).checks if not c.passed]


def sealed(version: str) -> dict:
    s = AgentLedgerSession(agent_id="a", canonicalization=version)
    s.record(ActionType.DECISION, reasoning="Recommend DECLINE")
    s.record(
        ActionType.TOOL_CALL,
        input={"tool": "create_credit_line", "args": {"amount": 2400000}},
        output={"id": "CL-1"},
    )
    s.record(ActionType.QUERY, output={"done": True})
    s.seal()
    return save_and_load(s)


# --- to_json_value ------------------------------------------------------------


class Color(str, Enum):
    RED = "red"


def test_to_json_value_reduces_to_plain_json():
    value = {
        "at": datetime(2026, 10, 30, 12, 0, 0, 123456, tzinfo=timezone.utc),
        "local": datetime(2026, 10, 30, 8, 0, tzinfo=timezone(timedelta(hours=-4))),
        "tuple": (1, "x", None),
        "enum": Color.RED,
        "nan": math.nan,
        "nested": {"ok": True},
    }
    out = to_json_value(value)
    assert out == {
        "at": "2026-10-30T12:00:00.123Z",
        "local": "2026-10-30T12:00:00.000Z",
        "tuple": [1, "x", None],
        "enum": "red",
        "nan": None,
        "nested": {"ok": True},
    }
    assert type(out["enum"]) is str


def test_to_json_value_returns_a_copy():
    data = {"args": {"amount": 1}}
    out = to_json_value(data)
    data["args"]["amount"] = 2
    assert out["args"]["amount"] == 1


def test_to_json_value_rejects_with_path():
    with pytest.raises(ValueError, match=r"\$\.a\.b\[1\]"):
        to_json_value({"a": {"b": [1, math.inf]}}, strict_numbers=True)
    c = {"x": 1}
    c["self"] = c
    with pytest.raises(ValueError, match=r"circular reference at \$\.c\.self"):
        to_json_value({"c": c})
    with pytest.raises(ValueError, match="naive datetime at"):
        to_json_value({"t": datetime(2026, 1, 1)})
    with pytest.raises(TypeError, match="keys must be strings"):
        to_json_value({1: "x"})
    with pytest.raises(TypeError, match=r"type set at \$\.s"):
        to_json_value({"s": {1, 2}})


def test_to_json_value_allows_shared_objects_that_are_not_circular():
    shared = {"v": 1}
    assert to_json_value({"a": shared, "b": shared}) == {"a": {"v": 1}, "b": {"v": 1}}


# --- sessions ---------------------------------------------------------------


@pytest.mark.parametrize("version", ["v1", "v2"])
def test_session_seals_with_matching_root_and_verifies(version):
    s = AgentLedgerSession(agent_id="a", canonicalization=version)
    s.record(ActionType.QUERY, input={"args": {"x": 1}}, output={"y": 2})
    s.record(ActionType.QUERY, output={"z": 3})
    s.record(ActionType.QUERY, output={"w": 4})
    sealed_session = s.seal()
    hashes = [r.hash for r in s.get_records()]
    expected = compute_merkle_root_v2(hashes) if version == "v2" else compute_merkle_root(hashes)
    assert s.get_hash_version() == version
    assert sealed_session.merkle_root == expected
    assert s.verify().valid
    for i in range(3):
        assert s.verify_proof(s.prove_record(i))
    session = s.export()["session"]
    if version == "v2":
        assert session["canonicalization"] == "v2" and session["merkle"] == "v2"
    else:
        assert "canonicalization" not in session and "merkle" not in session


def test_v1_is_the_default():
    assert AgentLedgerSession(agent_id="a").get_hash_version() == "v1"


def test_unknown_version_is_rejected():
    with pytest.raises(ValueError, match="unknown canonicalization"):
        AgentLedgerSession(agent_id="a", canonicalization="v3")


def test_v2_proof_does_not_verify_for_another_record():
    s = AgentLedgerSession(agent_id="a", canonicalization="v2")
    for i in range(3):
        s.record(ActionType.QUERY, output={"i": i})
    s.seal()
    proof = s.prove_record(1)
    proof.record_hash = s.get_record(0).hash
    assert not s.verify_proof(proof)


@pytest.mark.parametrize("version", ["v1", "v2"])
def test_datetime_is_stored_as_iso_and_verifies_after_reload(version):
    s = AgentLedgerSession(agent_id="a", canonicalization=version)
    s.record(ActionType.QUERY, output={"at": datetime(2026, 10, 30, 12, tzinfo=timezone.utc)})
    s.seal()
    assert s.get_record(0).output["at"] == "2026-10-30T12:00:00.000Z"
    assert s.verify().valid
    assert verify_exported_session(save_and_load(s)).valid


def test_v2_hashes_a_datetime_by_its_value():
    def record_at(dt):
        s = AgentLedgerSession(agent_id="a", canonicalization="v2")
        return s.record(ActionType.QUERY, output={"at": dt})

    r = record_at(datetime(2026, 10, 30, 12, tzinfo=timezone.utc))
    fields = dict(
        id=r.id, session_id=r.session_id, sequence_number=0, timestamp=r.timestamp,
        agent_id="a", action_type="query", input={}, previous_hash=None,
    )
    assert r.hash == hash_action_record_v2(**fields, output={"at": "2026-10-30T12:00:00.000Z"})
    assert r.hash != hash_action_record_v2(**fields, output={"at": "1999-01-01T00:00:00.000Z"})


# --- isolation ----------------------------------------------------------------


def test_later_changes_to_the_callers_objects_are_ignored():
    s = AgentLedgerSession(agent_id="a", canonicalization="v2")
    args = {"customerId": "MER-100", "amount": 2400000}
    output = {"status": "active"}
    s.record(ActionType.TOOL_CALL, input={"tool": "t", "args": args}, output=output)
    args["amount"] = 1
    output["status"] = "changed"
    s.seal()
    assert s.verify().valid
    assert s.get_record(0).input["args"]["amount"] == 2400000
    assert verify_exported_session(save_and_load(s)).valid


def test_changes_to_returned_records_are_ignored():
    s = AgentLedgerSession(agent_id="a", canonicalization="v2", metadata={"m": {"k": 1}})
    returned = s.record(ActionType.QUERY, output={"v": 1})
    returned.output["v"] = 2
    s.get_record(0).output["v"] = 3
    s.get_records()[0].output["v"] = 4
    s.export()["records"][0]["output"]["v"] = 5
    s.to_audit_session().metadata["m"]["k"] = 2
    s.seal()
    assert s.verify().valid
    assert s.get_record(0).output["v"] == 1
    assert s.export()["session"]["metadata"] == {"m": {"k": 1}}


def test_nan_is_rejected_under_v2_and_becomes_none_under_v1():
    s2 = AgentLedgerSession(agent_id="a", canonicalization="v2")
    with pytest.raises(ValueError, match=r"output: cannot serialize non-finite number nan at \$\.x"):
        s2.record(ActionType.QUERY, output={"x": math.nan})
    s1 = AgentLedgerSession(agent_id="a")
    s1.record(ActionType.QUERY, output={"x": math.nan})
    s1.seal()
    assert s1.get_record(0).output["x"] is None
    assert verify_exported_session(save_and_load(s1)).valid


def test_copy_leaves_the_hash_of_plain_json_unchanged():
    data = ActionRecordInput(
        agent_id="a",
        action_type=ActionType.TOOL_CALL,
        input={"tool": "t", "args": {"a": 1, "b": [1, "x", None], "c": {"d": True}}},
        output={"ok": True, "f": 149.0},
        metadata={"m": 1},
    )
    for version, hasher in (("v1", hash_action_record), ("v2", hash_action_record_v2)):
        r = create_action_record("s", data, 0, None, version)
        assert r.hash == hasher(
            id=r.id, session_id="s", sequence_number=0, timestamp=r.timestamp, agent_id="a",
            action_type="tool_call", input=data.input, output=data.output,
            metadata=data.metadata, previous_hash=None,
        )


# --- verify_exported_session ----------------------------------------------------


@pytest.mark.parametrize("version", ["v1", "v2"])
def test_verifies_a_saved_session(version):
    result = verify_exported_session(sealed(version))
    assert result.valid, [c.to_dict() for c in result.checks]
    assert [c.name for c in result.checks] == [
        "hash_version", "hash_chain_integrity", "session_consistency", "merkle_root_integrity",
    ]


def test_catches_a_nested_argument_edit_v2():
    doc = sealed("v2")
    doc["records"][1]["input"]["args"]["amount"] = 240000
    assert failed(doc) == ["hash_chain_integrity"]


def test_v1_still_misses_a_nested_argument_edit():
    doc = sealed("v1")
    doc["records"][1]["input"]["args"]["amount"] = 240000
    assert verify_exported_session(doc).valid  # the documented v1 limitation


def test_catches_a_removed_record():
    doc = sealed("v2")
    del doc["records"][1]
    assert {"hash_chain_integrity", "session_consistency", "merkle_root_integrity"} <= set(failed(doc))


def test_catches_a_changed_root_and_a_foreign_record():
    doc = sealed("v2")
    doc["session"]["merkleRoot"] = "ab" * 32
    assert failed(doc) == ["merkle_root_integrity"]
    doc = sealed("v2")
    doc["records"][2]["sessionId"] = "someone-else"
    assert "session_consistency" in failed(doc)


def test_rejects_relabelled_and_conflicting_versions():
    doc = sealed("v2")
    del doc["session"]["canonicalization"], doc["session"]["merkle"]
    assert not verify_exported_session(doc).valid
    doc = sealed("v2")
    doc["session"]["merkle"] = "v1"
    assert "hash_version" in failed(doc)
    doc = sealed("v2")
    doc["canonicalization"] = "v1"
    assert "hash_version" in failed(doc)


def test_accepts_versions_at_the_top_level():
    doc = sealed("v2")
    del doc["session"]["canonicalization"], doc["session"]["merkle"]
    doc["canonicalization"] = doc["merkle"] = "v2"
    assert verify_exported_session(doc).valid


def test_unsealed_export_verifies_by_its_chain():
    s = AgentLedgerSession(agent_id="a")
    s.record(ActionType.QUERY)
    result = verify_exported_session(save_and_load(s))
    assert result.valid
    assert "merkle_root_integrity" not in [c.name for c in result.checks]


@pytest.mark.parametrize("doc", [{}, None, {"session": {}, "records": [{"id": "x"}]}, {"session": 1, "records": []}])
def test_rejects_something_that_is_not_an_exported_session(doc):
    result = verify_exported_session(doc)
    assert not result.valid
    assert result.checks[0].name == "document_shape"


# --- TypeScript library export -> Python --------------------------------------


def test_typescript_library_export_verifies_in_python():
    doc = json.loads((FIXTURES / "ts_lib_v2_session.json").read_text(encoding="utf-8"))
    assert doc["session"]["canonicalization"] == "v2" and "canonicalization" not in doc
    result = verify_exported_session(doc)
    assert result.valid, [c.to_dict() for c in result.checks]
    doc["records"][1]["input"]["args"]["amount"] = 240000
    assert failed(doc) == ["hash_chain_integrity"]
