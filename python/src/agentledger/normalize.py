"""
Plain-JSON copies (Python counterpart of ``toJSONValue`` in ``src/core/canonical.ts``).

``record()`` stores a copy of what the caller passes, reduced to plain JSON, so
that what gets hashed is exactly what a saved session file holds and later
changes to the caller's objects cannot reach the ledger.

The copy contains only ``dict`` (string keys), ``list``, ``str``, ``int``,
``float``, ``bool`` and ``None``:
  * tuples become lists; an Enum becomes its value; other ``str``, ``int`` and
    ``float`` subclasses become the plain type
  * an aware ``datetime`` becomes its ISO string in UTC with milliseconds, as
    JavaScript's ``Date.toISOString()`` writes it; a naive one is rejected,
    because it does not say which time it is
  * NaN and Infinity become ``None`` (as ``JSON.stringify`` does), or raise
    with ``strict_numbers`` (v2)
Anything else, non-string keys and circular references raise, naming the path
where they occur (for example ``$.c.self``).
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Mapping, Set


def to_json_value(value: Any, *, strict_numbers: bool = False) -> Any:
    """Return a deep copy of ``value`` reduced to plain JSON (see module docs)."""
    return _normalize(value, "$", set(), strict_numbers)


def _js_iso(dt: datetime) -> str:
    if dt.tzinfo is None or dt.utcoffset() is None:
        raise ValueError("naive datetime")
    u = dt.astimezone(timezone.utc)
    return u.strftime("%Y-%m-%dT%H:%M:%S.") + f"{u.microsecond // 1000:03d}Z"


def _normalize(value: Any, path: str, ancestors: Set[int], strict: bool) -> Any:
    if value is None or value is True or value is False:
        return value
    if isinstance(value, Enum):
        return _normalize(value.value, path, ancestors, strict)
    if isinstance(value, str):
        return str.__str__(value)  # the characters, even for a subclass overriding __str__
    if isinstance(value, int):
        return int(value)
    if isinstance(value, float):
        if math.isfinite(value):
            return float(value)
        if strict:
            raise ValueError(f"cannot serialize non-finite number {value} at {path}")
        return None
    if isinstance(value, datetime):
        try:
            return _js_iso(value)
        except ValueError:
            raise ValueError(
                f"cannot serialize a naive datetime at {path}; give it a timezone"
            ) from None
    if isinstance(value, (Mapping, list, tuple)):
        if id(value) in ancestors:
            raise ValueError(f"cannot serialize a circular reference at {path}")
        ancestors.add(id(value))
        try:
            if isinstance(value, Mapping):
                out = {}
                for k, v in value.items():
                    if not isinstance(k, str):
                        raise TypeError(
                            f"cannot serialize a {type(k).__name__} key {k!r} at {path}; keys must be strings"
                        )
                    out[str(k)] = _normalize(v, f"{path}.{k}", ancestors, strict)
                return out
            return [_normalize(v, f"{path}[{i}]", ancestors, strict) for i, v in enumerate(value)]
        finally:
            ancestors.discard(id(value))
    raise TypeError(f"cannot serialize a value of type {type(value).__name__} at {path}")
