"""Unit tests for canonical hashing and JS-faithful serialization."""

import pytest

from agentledger.hashing import (
    _emit_number,
    combine_hashes,
    hash_action_record,
    sha256,
    sorted_stringify,
)


def test_sha256_known_vector():
    # echo -n "" | sha256sum
    assert sha256("") == (
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    )
    assert sha256("abc") == (
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    )


def test_sorted_stringify_sorts_top_level_keys():
    assert sorted_stringify({"b": 1, "a": 2}) == '{"a":2,"b":1}'


def test_sorted_stringify_drops_nested_keys_like_js_v1():
    # Documented v1 behavior: nested keys not in the top-level set are dropped.
    assert sorted_stringify({"tool": "x", "args": {"id": "MER-100"}}) == (
        '{"args":{},"tool":"x"}'
    )


def test_sorted_stringify_empty_object():
    assert sorted_stringify({}) == "{}"


@pytest.mark.parametrize(
    "value,expected",
    [
        (149.0, "149"),      # integer-valued float -> no decimal
        (-3.0, "-3"),
        (0.0, "0"),
        (126.65, "126.65"),
        (1e21, "1e+21"),
        (1e-7, "1e-7"),      # JS minimal exponent, not Python's 1e-07
        (10, "10"),
        (float("nan"), "null"),
        (float("inf"), "null"),
    ],
)
def test_emit_number_matches_js(value, expected):
    assert _emit_number(value) == expected


def test_metadata_truthiness_empty_vs_none():
    # Empty metadata is serialized ({} is truthy in JS); None yields ''.
    base = dict(
        id="i", session_id="s", sequence_number=0, timestamp="t",
        agent_id=None, action_type="decision", input={}, output={},
    )
    with_empty = hash_action_record(**base, metadata={})
    with_none = hash_action_record(**base, metadata=None)
    assert with_empty != with_none


def test_combine_hashes_is_order_sensitive():
    a, b = sha256("a"), sha256("b")
    assert combine_hashes(a, b) != combine_hashes(b, a)
