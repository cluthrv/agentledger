"""
Hashing utilities for AgentLedger (Python).

All cryptographic operations use SHA-256 via the standard-library ``hashlib``.
No third-party dependencies.

This module is a faithful v1 port of ``src/core/hash.ts`` from the TypeScript
library. Producing byte-identical canonical strings to JavaScript's
``JSON.stringify`` is what lets Python regenerate the identical record hashes
and Merkle roots sealed by the TypeScript library, so the two implementations
cross-verify the same sessions.

Two JavaScript behaviors are reproduced deliberately:

1. ``JSON.stringify(obj, keyArray)`` treats the array as a property allowlist
   applied at *every* nesting level, so nested object keys absent from the
   top-level key set are dropped. ``sorted_stringify`` reproduces this. See
   ``CANONICALIZATION.md`` for the limitation this preserves and the planned
   v2 fix.

2. Number formatting follows ECMAScript ``Number::toString``: integer-valued
   floats serialize without a decimal point (``149.0`` -> ``149``), and
   exponent notation uses JS's minimal form (``1e-7``, not ``1e-07``). Python's
   own ``json`` module does not do this, so numbers are emitted by a custom
   serializer below.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from typing import Any, Mapping, Optional

_EXP_RE = re.compile(r"[eE]")


def sha256(data: str) -> str:
    """Compute the SHA-256 hex digest of a UTF-8 string."""
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


# --- JS-faithful canonical serialization ----------------------------------


def _emit_str(s: str) -> str:
    """Serialize a string exactly like ``JSON.stringify`` of that string.

    Python's ``json.dumps(ensure_ascii=False)`` matches V8's escaping for the
    control set, ``"`` and ``\\``, and leaves other non-ASCII raw. The only
    divergence is the line/paragraph separators, which ES2019+ escapes and
    Python does not, so they are patched here.
    """
    out = json.dumps(s, ensure_ascii=False)
    if "\u2028" in s or "\u2029" in s:
        out = out.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    return out


def _emit_number(x: Any) -> str:
    """Serialize an int or float the way ECMAScript ``Number::toString`` does."""
    if isinstance(x, int):  # bool handled before this is reached
        return str(x)

    # float
    if math.isnan(x) or math.isinf(x):
        return "null"  # JSON.stringify turns NaN/Infinity into null
    if x == 0:
        return "0"  # covers 0.0 and -0.0 (JSON.stringify(-0) === "0")
    if x == math.floor(x) and abs(x) < 1e21:
        return str(int(x))  # integer-valued float -> no decimal point

    r = repr(x)
    if _EXP_RE.search(r):
        mantissa, exp = _EXP_RE.split(r)
        e = int(exp)
        r = f"{mantissa}e{'+' if e >= 0 else '-'}{abs(e)}"
    return r


def _emit(value: Any) -> str:
    """Serialize a value to a JS-``JSON.stringify``-identical string."""
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, str):
        return _emit_str(value)
    if isinstance(value, (int, float)):
        return _emit_number(value)
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(_emit(v) for v in value) + "]"
    if isinstance(value, Mapping):
        # Keys are already filtered/ordered by the caller; emit in that order,
        # skipping undefined-like values the way JSON.stringify drops them is
        # not needed here because our structures never contain them.
        parts = [f"{_emit_str(str(k))}:{_emit(v)}" for k, v in value.items()]
        return "{" + ",".join(parts) + "}"
    raise TypeError(f"Cannot serialize value of type {type(value).__name__}")


def _apply_proplist(node: Any, proplist: list[str]) -> Any:
    """Mirror JavaScript's ``JSON.stringify(value, keyArray)`` allowlist.

    The replacer array filters object keys at every depth and fixes their
    output order to the array's order. Array elements are not filtered; their
    contents are transformed recursively with the same allowlist.
    """
    if isinstance(node, Mapping):
        out: dict[str, Any] = {}
        for key in proplist:  # proplist order drives output key order
            if key in node:
                out[key] = _apply_proplist(node[key], proplist)
        return out
    if isinstance(node, (list, tuple)):
        return [_apply_proplist(item, proplist) for item in node]
    return node


def sorted_stringify(obj: Mapping[str, Any]) -> str:
    """Deterministic serialization with sorted top-level keys.

    Equivalent to the TypeScript ``sortedStringify``:
        JSON.stringify(obj, Object.keys(obj).sort())
    including the nested-key allowlist behavior described in the module
    docstring.
    """
    proplist = sorted(obj.keys())
    return _emit(_apply_proplist(obj, proplist))


def _nullish(value: Optional[str]) -> str:
    """Reproduce ``value ?? ''`` (only None/undefined become '')."""
    return "" if value is None else value


def hash_action_record(
    *,
    id: str,
    session_id: str,
    sequence_number: int,
    timestamp: str,
    agent_id: Optional[str],
    action_type: str,
    input: Mapping[str, Any],
    output: Mapping[str, Any],
    reasoning: Optional[str] = None,
    metadata: Optional[Mapping[str, Any]] = None,
    previous_hash: Optional[str] = None,
) -> str:
    """Compute the hash of an Action Record's content fields.

    Field order and serialization match ``hashActionRecord`` in the TypeScript
    library exactly:

      [id, sessionId, sequenceNumber, timestamp, agentId, actionType,
       sortedStringify(input), sortedStringify(output),
       reasoning ?? '', metadata ? sortedStringify(metadata) : '',
       previousHash ?? '']

    Fidelity notes:
      * ``agent_id`` of None serializes to JSON ``null`` (JS undefined in an
        array becomes null).
      * ``metadata`` uses a truthiness gate: any mapping, including empty, is
        serialized; only None yields '' (``{}`` is truthy in JS).
      * ``reasoning``/``previous_hash`` use nullish coalescing: only None -> ''.
    """
    metadata_part = "" if metadata is None else sorted_stringify(metadata)

    canonical = _emit(
        [
            id,
            session_id,
            sequence_number,
            timestamp,
            agent_id,  # None -> null
            action_type,
            sorted_stringify(input),
            sorted_stringify(output),
            _nullish(reasoning),
            metadata_part,
            _nullish(previous_hash),
        ]
    )
    return sha256(canonical)


def combine_hashes(left: str, right: str) -> str:
    """Combine two hashes for Merkle construction: sha256(left + right)."""
    return sha256(left + right)
