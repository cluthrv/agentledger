/**
 * Merkle Tree Engine
 *
 * Builds a binary Merkle tree from Action Record hashes.
 * Provides:
 *   - Root hash computation (single fingerprint for an entire session)
 *   - Merkle proof generation (verify one record in O(log n))
 *   - Proof verification (confirm a record belongs to a sealed session)
 */

import { createHash } from 'crypto';
import { MerkleNode, MerkleProof, MerkleProofV2 } from '../types';
import { combineHashes, sha256 } from './hash';

/**
 * Build a Merkle tree from an array of Action Record hashes.
 *
 * If the number of leaves is odd, the last hash is duplicated
 * to create a balanced tree. This is standard Merkle tree behavior.
 *
 * @param hashes - Array of SHA-256 hashes from Action Records
 * @returns The root MerkleNode, or null if the input is empty
 */
export function buildMerkleTree(hashes: string[]): MerkleNode | null {
  if (hashes.length === 0) {
    return null;
  }

  // Create leaf nodes
  let nodes: MerkleNode[] = hashes.map((hash, index) => ({
    hash: sha256(hash), // Hash the record hash to create the leaf hash
    left: null,
    right: null,
    recordIndex: index,
  }));

  // Build tree bottom-up
  while (nodes.length > 1) {
    const nextLevel: MerkleNode[] = [];

    for (let i = 0; i < nodes.length; i += 2) {
      const left = nodes[i];
      // If odd number of nodes, duplicate the last one
      const right = i + 1 < nodes.length ? nodes[i + 1] : { ...nodes[i] };

      const parentHash = combineHashes(left.hash, right.hash);

      nextLevel.push({
        hash: parentHash,
        left,
        right,
      });
    }

    nodes = nextLevel;
  }

  return nodes[0];
}

/**
 * Get the root hash of a Merkle tree built from Action Record hashes.
 *
 * This is the single cryptographic fingerprint that represents
 * the entire session. If any record is modified, the root changes.
 *
 * @param hashes - Array of SHA-256 hashes from Action Records
 * @returns The root hash string, or null if input is empty
 */
export function computeMerkleRoot(hashes: string[]): string | null {
  const tree = buildMerkleTree(hashes);
  return tree ? tree.hash : null;
}

/**
 * Generate a Merkle proof for a specific Action Record.
 *
 * The proof contains the sibling hashes needed to recompute
 * the root from the target leaf. An auditor can verify that
 * a specific record belongs to a sealed session without
 * needing access to all other records.
 *
 * @param hashes - All Action Record hashes in the session
 * @param recordIndex - Index of the record to generate a proof for
 * @returns A MerkleProof object, or null if index is out of bounds
 */
export function generateMerkleProof(
  hashes: string[],
  recordIndex: number
): MerkleProof | null {
  if (recordIndex < 0 || recordIndex >= hashes.length || hashes.length === 0) {
    return null;
  }

  const root = computeMerkleRoot(hashes);
  if (!root) return null;

  // Build leaf hashes
  const leafHashes = hashes.map((h) => sha256(h));
  const siblings: MerkleProof['siblings'] = [];

  // Walk up the tree collecting siblings
  let currentLevel = [...leafHashes];
  let targetIndex = recordIndex;

  while (currentLevel.length > 1) {
    const nextLevel: string[] = [];

    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i];
      const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : currentLevel[i];

      // If target is in this pair, collect the sibling
      if (i === targetIndex || i + 1 === targetIndex) {
        if (targetIndex % 2 === 0) {
          // Target is left child, sibling is on the right
          siblings.push({
            hash: right,
            position: 'right',
          });
        } else {
          // Target is right child, sibling is on the left
          siblings.push({
            hash: left,
            position: 'left',
          });
        }
      }

      nextLevel.push(combineHashes(left, right));
    }

    currentLevel = nextLevel;
    targetIndex = Math.floor(targetIndex / 2);
  }

  return {
    recordIndex,
    recordHash: hashes[recordIndex],
    siblings,
    root,
  };
}

/**
 * Verify a Merkle proof against a claimed root hash.
 *
 * Recomputes the root by hashing the record hash with each
 * sibling in sequence. If the result matches the claimed root,
 * the proof is valid.
 *
 * @param proof - The MerkleProof to verify
 * @returns true if the proof is valid
 */
export function verifyMerkleProof(proof: MerkleProof): boolean {
  let currentHash = sha256(proof.recordHash);

  for (const sibling of proof.siblings) {
    if (sibling.position === 'right') {
      currentHash = combineHashes(currentHash, sibling.hash);
    } else {
      currentHash = combineHashes(sibling.hash, currentHash);
    }
  }

  return currentHash === proof.root;
}

// ---------------------------------------------------------------------------
// Merkle v2 (RFC 6962 style)
//
//   leaf = SHA-256(0x00 || recordHash bytes)
//   node = SHA-256(0x01 || left bytes || right bytes)
//
// The 0x00 / 0x01 prefixes keep a leaf from ever being read as an inner node.
// An odd node at the end of a level is carried up unchanged, never duplicated,
// so the tree has the same shape as RFC 6962's. Record hashes are 32-byte hex.
// ---------------------------------------------------------------------------

const LEAF_PREFIX = Buffer.from([0x00]);
const NODE_PREFIX = Buffer.from([0x01]);

function hashBytes(...parts: Buffer[]): string {
  return createHash('sha256').update(Buffer.concat(parts)).digest('hex');
}

function hexToBytes(hex: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(`Merkle v2: expected a 32-byte hex hash, got "${hex}"`);
  }
  return Buffer.from(hex, 'hex');
}

/** Leaf hash for one record hash. */
export function merkleLeafV2(recordHash: string): string {
  return hashBytes(LEAF_PREFIX, hexToBytes(recordHash));
}

/** Inner node hash for two child hashes. */
export function merkleNodeV2(left: string, right: string): string {
  return hashBytes(NODE_PREFIX, hexToBytes(left), hexToBytes(right));
}

/**
 * Merkle v2 root over record hashes, or null for an empty list.
 */
export function computeMerkleRootV2(recordHashes: string[]): string | null {
  if (recordHashes.length === 0) return null;
  let level = recordHashes.map(merkleLeafV2);
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(i + 1 < level.length ? merkleNodeV2(level[i], level[i + 1]) : level[i]);
    }
    level = next;
  }
  return level[0];
}

/**
 * Merkle v2 proof for one record: the sibling hashes from its leaf to the
 * root. A level where the record's node is carried up adds no sibling.
 */
export function generateMerkleProofV2(
  recordHashes: string[],
  recordIndex: number
): MerkleProofV2 | null {
  if (recordIndex < 0 || recordIndex >= recordHashes.length) return null;
  const siblings: MerkleProofV2['siblings'] = [];
  let level = recordHashes.map(merkleLeafV2);
  let index = recordIndex;
  while (level.length > 1) {
    if (index % 2 === 1) {
      siblings.push({ hash: level[index - 1], position: 'left' });
    } else if (index + 1 < level.length) {
      siblings.push({ hash: level[index + 1], position: 'right' });
    }
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(i + 1 < level.length ? merkleNodeV2(level[i], level[i + 1]) : level[i]);
    }
    level = next;
    index = Math.floor(index / 2);
  }
  return { version: 'v2', recordIndex, recordHash: recordHashes[recordIndex], siblings, root: level[0] };
}

/**
 * Verify a Merkle v2 proof: rebuild the root from the record hash and the
 * siblings, and compare it with the proof's root.
 */
export function verifyMerkleProofV2(proof: MerkleProofV2): boolean {
  try {
    let current = merkleLeafV2(proof.recordHash);
    for (const sibling of proof.siblings) {
      current = sibling.position === 'right'
        ? merkleNodeV2(current, sibling.hash)
        : merkleNodeV2(sibling.hash, current);
    }
    return current === proof.root;
  } catch {
    return false;
  }
}
