"""
Canonical JSON (v2), byte-identical to ``canonicalJson`` in ``src/core/canonical.ts``.

Follows RFC 8785 (JSON Canonicalization Scheme):
  * object keys sorted by UTF-16 code units, at every depth
  * numbers in ECMAScript ``Number.prototype.toString`` form; NaN and Infinity
    are rejected
  * strings escaped exactly as JavaScript's ``JSON.stringify`` escapes them
  * no whitespace

Python ``None`` is JSON ``null`` and is kept. (JavaScript drops ``undefined``
object members; Python has no undefined, so callers leave such keys out.)

The v1 serializer in ``hashing.py`` differs from JavaScript for numbers between
1e-7 and 1e-4 and for U+2028/U+2029; it is left unchanged so v1 hashes stay
stable. This module is correct for both.
"""

from __future__ import annotations

import json
import math
from decimal import Decimal
from typing import Any, Mapping

_MAX_SAFE_INT = 2**53


def _es_number(x: Any) -> str:
    """Format a number as ECMAScript ``Number::toString`` does."""
    if isinstance(x, int):
        if abs(x) <= _MAX_SAFE_INT:
            return str(x)
        x = float(x)  # JavaScript holds it as a double
    if math.isnan(x) or math.isinf(x):
        raise ValueError(f"canonical_json: cannot serialize non-finite number {x}")
    if x == 0:
        return "0"  # also -0
    sign = "-" if x < 0 else ""
    # repr gives the shortest digits that round-trip, as ECMAScript requires.
    t = Decimal(repr(abs(x))).as_tuple()
    digits = list(t.digits)
    exp = t.exponent
    while len(digits) > 1 and digits[-1] == 0:
        digits.pop()
        exp += 1
    s = "".join(str(d) for d in digits)
    k = len(s)
    n = k + exp  # value = 0.s * 10^n
    if k <= n <= 21:
        out = s + "0" * (n - k)
    elif 0 < n <= 21:
        out = s[:n] + "." + s[n:]
    elif -6 < n <= 0:
        out = "0." + "0" * (-n) + s
    else:
        e = n - 1
        out = s[0] + ("." + s[1:] if k > 1 else "") + "e" + ("+" if e >= 0 else "-") + str(abs(e))
    return sign + out


def _es_string(s: str) -> str:
    """Escape a string as JavaScript's ``JSON.stringify`` does."""
    if any(0xD800 <= ord(c) <= 0xDFFF for c in s):
        raise ValueError("canonical_json: strings with lone surrogates are not supported")
    # Matches JSON.stringify: \" \\ \b \f \n \r \t, other controls as \u00xx,
    # everything else (including U+2028 / U+2029) left as is.
    return json.dumps(s, ensure_ascii=False)


def _utf16_key(k: str) -> bytes:
    return k.encode("utf-16-be")


def canonical_json(value: Any) -> str:
    """Serialize ``value`` canonically (RFC 8785)."""
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, str):
        return _es_string(value)
    if isinstance(value, (int, float)):
        return _es_number(value)
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(canonical_json(v) for v in value) + "]"
    if isinstance(value, Mapping):
        keys = sorted((str(k) for k in value.keys()), key=_utf16_key)
        return "{" + ",".join(_es_string(k) + ":" + canonical_json(value[k]) for k in keys) + "}"
    raise TypeError(f"canonical_json: cannot serialize a value of type {type(value).__name__}")
