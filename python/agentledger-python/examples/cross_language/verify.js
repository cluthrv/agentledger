// Verify a Python-sealed session with the published TypeScript library.
//
//   npm install @vluthra/agent-ledger
//   node verify.js
//
// Expects python_session.json produced by roundtrip.py.

const fs = require('fs');
const path = require('path');
const {
  verifyChain,
  computeMerkleRoot,
  verifyActionRecord,
  generateMerkleProof,
  verifyMerkleProof,
} = require('@vluthra/agent-ledger');

const doc = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'python_session.json'), 'utf8')
);
const records = doc.records;

const perRecord = records.map(verifyActionRecord);
const chain = verifyChain(records);
const tsRoot = computeMerkleRoot(records.map((r) => r.hash));
const proof = generateMerkleProof(records.map((r) => r.hash), 1);

console.log('per-record hash verify:', perRecord);
console.log('chain valid:', chain.valid, chain.errors);
console.log('root equal:', tsRoot === doc.session.merkleRoot, tsRoot);
console.log('proof verifies:', verifyMerkleProof(proof));

const ok =
  perRecord.every(Boolean) &&
  chain.valid &&
  tsRoot === doc.session.merkleRoot &&
  verifyMerkleProof(proof);
console.log('\nPython -> TypeScript verified:', ok);
process.exit(ok ? 0 : 1);
