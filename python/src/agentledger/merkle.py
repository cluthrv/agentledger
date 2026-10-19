"""
Merkle tree engine (Python port of ``src/core/merkle.ts``).

Builds a binary Merkle tree from Action Record hashes and supports:
  * root computation (a single fingerprint for an entire session)
  * Merkle proof generation (verify one record in O(log n))
  * proof verification (confirm a record belongs to a sealed session)

Leaf construction, odd-node duplication, sibling selection and proof
verification all mirror the TypeScript implementation exactly so proofs
generated in one language verify in the other.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Literal, Optional

from .hashing import combine_hashes, sha256


@dataclass
class MerkleSibling:
    hash: str
    position: Literal["left", "right"]

    def to_dict(self) -> dict:
        return {"hash": self.hash, "position": self.position}

    @staticmethod
    def from_dict(d: dict) -> "MerkleSibling":
        return MerkleSibling(hash=d["hash"], position=d["position"])


@dataclass
class MerkleProof:
    record_index: int
    record_hash: str
    siblings: List[MerkleSibling] = field(default_factory=list)
    root: str = ""

    def to_dict(self) -> dict:
        return {
            "recordIndex": self.record_index,
            "recordHash": self.record_hash,
            "siblings": [s.to_dict() for s in self.siblings],
            "root": self.root,
        }

    @staticmethod
    def from_dict(d: dict) -> "MerkleProof":
        return MerkleProof(
            record_index=d["recordIndex"],
            record_hash=d["recordHash"],
            siblings=[MerkleSibling.from_dict(s) for s in d.get("siblings", [])],
            root=d["root"],
        )


def compute_merkle_root(hashes: List[str]) -> Optional[str]:
    """
    Compute the Merkle root from an array of Action Record hashes.

    Each leaf is ``sha256(record_hash)``. Parents are
    ``sha256(left + right)``. With an odd number of nodes at a level, the
    last node is duplicated. Returns None for an empty input.
    """
    if not hashes:
        return None

    nodes = [sha256(h) for h in hashes]  # leaf = hash(record hash)
    while len(nodes) > 1:
        nxt: List[str] = []
        for i in range(0, len(nodes), 2):
            left = nodes[i]
            right = nodes[i + 1] if i + 1 < len(nodes) else nodes[i]
            nxt.append(combine_hashes(left, right))
        nodes = nxt
    return nodes[0]


def generate_merkle_proof(hashes: List[str], record_index: int) -> Optional[MerkleProof]:
    """
    Generate a Merkle proof for one record, matching ``generateMerkleProof``
    in the TypeScript library (sibling selection and odd-node handling
    included). Returns None if the index is out of range.
    """
    if record_index < 0 or record_index >= len(hashes) or not hashes:
        return None

    root = compute_merkle_root(hashes)
    if root is None:
        return None

    leaf_hashes = [sha256(h) for h in hashes]
    siblings: List[MerkleSibling] = []

    current_level = list(leaf_hashes)
    target_index = record_index

    while len(current_level) > 1:
        next_level: List[str] = []
        for i in range(0, len(current_level), 2):
            left = current_level[i]
            right = current_level[i + 1] if i + 1 < len(current_level) else current_level[i]

            if i == target_index or i + 1 == target_index:
                if target_index % 2 == 0:
                    siblings.append(MerkleSibling(hash=right, position="right"))
                else:
                    siblings.append(MerkleSibling(hash=left, position="left"))

            next_level.append(combine_hashes(left, right))

        current_level = next_level
        target_index = target_index // 2

    return MerkleProof(
        record_index=record_index,
        record_hash=hashes[record_index],
        siblings=siblings,
        root=root,
    )


def verify_merkle_proof(proof: MerkleProof) -> bool:
    """
    Verify a Merkle proof against its claimed root. Recomputes the root from
    the leaf and the ordered siblings; returns True on an exact match.
    """
    current = sha256(proof.record_hash)
    for sib in proof.siblings:
        if sib.position == "right":
            current = combine_hashes(current, sib.hash)
        else:
            current = combine_hashes(sib.hash, current)
    return current == proof.root


# ---------------------------------------------------------------------------
# Merkle v2 (RFC 6962 style), matching src/core/merkle.ts
#
#   leaf = SHA-256(0x00 || record hash bytes)
#   node = SHA-256(0x01 || left bytes || right bytes)
#
# An odd node at the end of a level is carried up unchanged, never duplicated.
# ---------------------------------------------------------------------------

import hashlib as _hashlib
import re as _re

_HEX32 = _re.compile(r"^[0-9a-fA-F]{64}$")


def _hex_bytes(h: str) -> bytes:
    if not _HEX32.match(h):
        raise ValueError(f"Merkle v2: expected a 32-byte hex hash, got {h!r}")
    return bytes.fromhex(h)


def merkle_leaf_v2(record_hash: str) -> str:
    return _hashlib.sha256(b"\x00" + _hex_bytes(record_hash)).hexdigest()


def merkle_node_v2(left: str, right: str) -> str:
    return _hashlib.sha256(b"\x01" + _hex_bytes(left) + _hex_bytes(right)).hexdigest()


def _next_level(level: List[str]) -> List[str]:
    return [
        merkle_node_v2(level[i], level[i + 1]) if i + 1 < len(level) else level[i]
        for i in range(0, len(level), 2)
    ]


def compute_merkle_root_v2(record_hashes: List[str]) -> Optional[str]:
    """Merkle v2 root over record hashes, or None for an empty list."""
    if not record_hashes:
        return None
    level = [merkle_leaf_v2(h) for h in record_hashes]
    while len(level) > 1:
        level = _next_level(level)
    return level[0]


def generate_merkle_proof_v2(record_hashes: List[str], record_index: int) -> Optional[MerkleProof]:
    """Merkle v2 proof; a level where the node is carried up adds no sibling."""
    if record_index < 0 or record_index >= len(record_hashes):
        return None
    siblings: List[MerkleSibling] = []
    level = [merkle_leaf_v2(h) for h in record_hashes]
    index = record_index
    while len(level) > 1:
        if index % 2 == 1:
            siblings.append(MerkleSibling(hash=level[index - 1], position="left"))
        elif index + 1 < len(level):
            siblings.append(MerkleSibling(hash=level[index + 1], position="right"))
        level = _next_level(level)
        index //= 2
    return MerkleProof(record_index=record_index, record_hash=record_hashes[record_index], siblings=siblings, root=level[0])


def verify_merkle_proof_v2(proof: MerkleProof) -> bool:
    try:
        current = merkle_leaf_v2(proof.record_hash)
        for s in proof.siblings:
            current = merkle_node_v2(current, s.hash) if s.position == "right" else merkle_node_v2(s.hash, current)
    except ValueError:
        return False
    return current == proof.root
