import {
  buildMerkleTree,
  computeMerkleRoot,
  generateMerkleProof,
  verifyMerkleProof,
} from '../core/merkle';
import { sha256 } from '../core/hash';

describe('buildMerkleTree', () => {
  it('should return null for empty input', () => {
    expect(buildMerkleTree([])).toBeNull();
  });

  it('should create a single-node tree for one hash', () => {
    const tree = buildMerkleTree(['hash-a']);
    expect(tree).not.toBeNull();
    expect(tree!.left).toBeNull();
    expect(tree!.right).toBeNull();
    // Single node: the root is the hash of 'hash-a' combined with itself
    // because a single leaf gets duplicated
  });

  it('should create a proper tree for two hashes', () => {
    const tree = buildMerkleTree(['hash-a', 'hash-b']);
    expect(tree).not.toBeNull();
    expect(tree!.left).not.toBeNull();
    expect(tree!.right).not.toBeNull();
    expect(tree!.left!.recordIndex).toBe(0);
    expect(tree!.right!.recordIndex).toBe(1);
  });

  it('should handle odd number of hashes by duplicating last', () => {
    const tree = buildMerkleTree(['h1', 'h2', 'h3']);
    expect(tree).not.toBeNull();
    // Tree should still be balanced
    expect(tree!.left).not.toBeNull();
    expect(tree!.right).not.toBeNull();
  });

  it('should produce different roots for different inputs', () => {
    const root1 = computeMerkleRoot(['a', 'b', 'c']);
    const root2 = computeMerkleRoot(['a', 'b', 'd']);
    expect(root1).not.toBe(root2);
  });
});

describe('computeMerkleRoot', () => {
  it('should return null for empty input', () => {
    expect(computeMerkleRoot([])).toBeNull();
  });

  it('should return a 64-char hex string', () => {
    const root = computeMerkleRoot(['hash-1', 'hash-2']);
    expect(root).toHaveLength(64);
    expect(root).toMatch(/^[0-9a-f]{64}$/);
  });

  it('should be deterministic', () => {
    const hashes = ['aaa', 'bbb', 'ccc', 'ddd'];
    const root1 = computeMerkleRoot(hashes);
    const root2 = computeMerkleRoot(hashes);
    expect(root1).toBe(root2);
  });

  it('should be order-sensitive', () => {
    const root1 = computeMerkleRoot(['a', 'b', 'c']);
    const root2 = computeMerkleRoot(['c', 'b', 'a']);
    expect(root1).not.toBe(root2);
  });

  it('should change if any hash changes', () => {
    const original = computeMerkleRoot(['h1', 'h2', 'h3', 'h4']);
    const modified = computeMerkleRoot(['h1', 'h2', 'TAMPERED', 'h4']);
    expect(original).not.toBe(modified);
  });
});

describe('generateMerkleProof', () => {
  const hashes = ['rec-0', 'rec-1', 'rec-2', 'rec-3'];

  it('should return null for out-of-bounds index', () => {
    expect(generateMerkleProof(hashes, -1)).toBeNull();
    expect(generateMerkleProof(hashes, 4)).toBeNull();
    expect(generateMerkleProof(hashes, 100)).toBeNull();
  });

  it('should return null for empty hashes', () => {
    expect(generateMerkleProof([], 0)).toBeNull();
  });

  it('should generate a valid proof for each record', () => {
    for (let i = 0; i < hashes.length; i++) {
      const proof = generateMerkleProof(hashes, i);
      expect(proof).not.toBeNull();
      expect(proof!.recordIndex).toBe(i);
      expect(proof!.recordHash).toBe(hashes[i]);
      expect(proof!.root).toBe(computeMerkleRoot(hashes));
      expect(proof!.siblings.length).toBeGreaterThan(0);
    }
  });

  it('should generate a proof for a single-element array', () => {
    const proof = generateMerkleProof(['only-hash'], 0);
    expect(proof).not.toBeNull();
    expect(proof!.recordIndex).toBe(0);
  });
});

describe('verifyMerkleProof', () => {
  it('should verify valid proofs for all records in a set', () => {
    const hashes = ['alpha', 'beta', 'gamma', 'delta'];

    for (let i = 0; i < hashes.length; i++) {
      const proof = generateMerkleProof(hashes, i);
      expect(proof).not.toBeNull();
      expect(verifyMerkleProof(proof!)).toBe(true);
    }
  });

  it('should reject a proof with a tampered record hash', () => {
    const hashes = ['a', 'b', 'c', 'd'];
    const proof = generateMerkleProof(hashes, 1)!;
    const tampered = { ...proof, recordHash: 'tampered-hash' };
    expect(verifyMerkleProof(tampered)).toBe(false);
  });

  it('should reject a proof with a tampered root', () => {
    const hashes = ['a', 'b', 'c', 'd'];
    const proof = generateMerkleProof(hashes, 2)!;
    const tampered = { ...proof, root: 'fake-root' };
    expect(verifyMerkleProof(tampered)).toBe(false);
  });

  it('should reject a proof with tampered siblings', () => {
    const hashes = ['a', 'b', 'c', 'd'];
    const proof = generateMerkleProof(hashes, 0)!;
    const tampered = {
      ...proof,
      siblings: proof.siblings.map((s) => ({ ...s, hash: 'corrupted' })),
    };
    expect(verifyMerkleProof(tampered)).toBe(false);
  });

  it('should work with odd-numbered hash sets', () => {
    const hashes = ['x', 'y', 'z'];
    for (let i = 0; i < hashes.length; i++) {
      const proof = generateMerkleProof(hashes, i)!;
      expect(verifyMerkleProof(proof)).toBe(true);
    }
  });

  it('should work with larger sets (16 records)', () => {
    const hashes = Array.from({ length: 16 }, (_, i) => `record-${i}`);
    for (let i = 0; i < hashes.length; i++) {
      const proof = generateMerkleProof(hashes, i)!;
      expect(verifyMerkleProof(proof)).toBe(true);
    }
  });

  it('should work with a single record', () => {
    const proof = generateMerkleProof(['sole-record'], 0)!;
    expect(verifyMerkleProof(proof)).toBe(true);
  });
});
