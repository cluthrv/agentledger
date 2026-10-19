// Regenerates v2_vectors.json from the TypeScript build (run `npm run build` at
// the repo root first):  node python/tests/fixtures/make_v2_vectors.js
// The Python tests check that canonical_json, hash_action_record_v2 and Merkle v2
// reproduce every value here byte for byte.
const fs = require("fs");
const path = require("path");
const {
  canonicalJson, hashActionRecordV2, sha256,
  computeMerkleRootV2, generateMerkleProofV2,
} = require("../../../dist");

const canonical = [
  { b: 1, a: { d: [3, { f: 4, e: 5 }], c: null } },
  [0.00001, 0.000001, 1e-7, 1.5e-7, 0.0001, 1e21, 1e20, 123456789012345680000, 1.7976931348623157e308, 5e-324],
  [2400000, -1, 0.1, 1.5, -2.5e-8, 9007199254740993, 1152921504606846976],
  ["plain", "quote \" backslash \\ slash /", "\n\r\t\b\f", "\u0001\u001f\u007f", "é ü — 中文 😀", "  "],
  { "b": 1, "B": 2, "é": 3, "a": 4, "😀": 5, "～": 6 },
  { empty: {}, list: [], t: true, f: false },
].map((value) => ({ value, canonical: canonicalJson(value) }));

const base = {
  id: "8c0d4c8a-1f2e-4b7a-9f00-000000000001",
  sessionId: "13a97669-8f6a-4c36-9391-ac982140e2c3",
  sequenceNumber: 7,
  timestamp: "2026-10-19T12:00:00.000Z",
  agentId: "sales-ops-agent",
  actionType: "tool_call",
  input: { tool: "create_credit_line", args: { customerId: "MER-100", amount: 2400000, approvalId: "APR-9382" } },
  output: { creditLineId: "CL-5678", status: "active", note: "café — ü" },
  metadata: { tool: "create_credit_line", system: "approval", trustDomain: "human:approval", serverReceipt: { argsHash: "aa", signature: "sig" } },
  previousHash: "ab".repeat(32),
};
const records = [
  base,
  { ...base, input: { ...base.input, args: { ...base.input.args, amount: 240000 } } },
  { ...base, sequenceNumber: 0, previousHash: null, agentId: undefined, metadata: undefined, actionType: "decision", input: {}, output: {}, reasoning: "Recommendation: DECLINE. Score 580 < 650." },
].map((r) => {
  const record = JSON.parse(JSON.stringify(r)); // what the JSON file holds (undefined dropped)
  return { record, hash: hashActionRecordV2(record) };
});

const leaves = Array.from({ length: 9 }, (_, i) => sha256("record-" + i));
const merkle = [];
for (let n = 1; n <= 9; n++) {
  const set = leaves.slice(0, n);
  merkle.push({ hashes: set, root: computeMerkleRootV2(set), proofs: set.map((_, i) => generateMerkleProofV2(set, i)) });
}

const out = path.join(__dirname, "v2_vectors.json");
fs.writeFileSync(out, JSON.stringify({ canonical, records, merkle }, null, 2) + "\n");
console.log("wrote " + out);
