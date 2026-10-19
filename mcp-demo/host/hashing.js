// ---------------------------------------------------------------------------
// HASH VERSIONS
// A session file says how it was hashed: "canonicalization" and "merkle", both
// "v2" for sessions recorded now, both absent (= v1) for older files. The
// verifier, prove and tamper all pick their functions from here.
//
// Reading the version from the file can't be used to downgrade a v2 session:
// its signatures are over agentledger/record-sig/v2 messages and its anchored
// root is a Merkle v2 root, and neither matches when recomputed as v1.
// ---------------------------------------------------------------------------
import {
  hashActionRecord, hashActionRecordV2,
  computeMerkleRoot, computeMerkleRootV2,
  generateMerkleProof, generateMerkleProofV2,
  verifyMerkleProof, verifyMerkleProofV2,
} from "@vluthra/agent-ledger";

export function sessionVersion(data) {
  const canonicalization = data.canonicalization ?? "v1";
  const merkle = data.merkle ?? "v1";
  const known = ["v1", "v2"].includes(canonicalization) && ["v1", "v2"].includes(merkle);
  return { canonicalization, merkle, consistent: known && canonicalization === merkle };
}

export const recordHash = (version, record) =>
  version === "v2" ? hashActionRecordV2(record) : hashActionRecord(record);

export const merkleRoot = (version, hashes) =>
  version === "v2" ? computeMerkleRootV2(hashes) : computeMerkleRoot(hashes);

export const merkleProof = (version, hashes, index) =>
  version === "v2" ? generateMerkleProofV2(hashes, index) : generateMerkleProof(hashes, index);

export const verifyProof = (version, proof) =>
  version === "v2" ? verifyMerkleProofV2(proof) : verifyMerkleProof(proof);
