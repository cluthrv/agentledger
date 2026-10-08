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
