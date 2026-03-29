/**
 * Merkle Tree Engine
 *
 * Builds a binary Merkle tree from Action Record hashes.
 * Provides:
 *   - Root hash computation (single fingerprint for an entire session)
 *   - Merkle proof generation (verify one record in O(log n))
 *   - Proof verification (confirm a record belongs to a sealed session)
 */

import { MerkleNode, MerkleProof } from '../types';
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
