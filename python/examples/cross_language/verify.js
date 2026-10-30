// Verify a Python-sealed session with the published TypeScript library.
//
//   npm install @vluthra/agent-ledger@0.2.0
//   node verify.js
//
// Expects python_session.json produced by roundtrip.py. Then edits a nested
// tool argument and confirms the TypeScript verifier catches it.

const fs = require('fs');
const path = require('path');
const { verifyExportedSession, generateMerkleProofV2, verifyMerkleProofV2 } = require('@vluthra/agent-ledger');

const doc = JSON.parse(fs.readFileSync(path.join(__dirname, 'python_session.json'), 'utf8'));

const result = verifyExportedSession(doc);
for (const c of result.checks) console.log(`${c.passed ? 'PASS' : 'FAIL'}  ${c.name}: ${c.detail}`);

const proof = generateMerkleProofV2(doc.records.map((r) => r.hash), 1);
const proofOk = proof.root === doc.session.merkleRoot && verifyMerkleProofV2(proof);
console.log('proof for record 1 verifies:', proofOk);

const tampered = JSON.parse(JSON.stringify(doc));
tampered.records[0].input.args.qty = 2000;
const caught = !verifyExportedSession(tampered).valid;
console.log('nested argument edit caught:', caught);

const ok = result.valid && proofOk && caught;
console.log('\nPython -> TypeScript verified:', ok);
process.exit(ok ? 0 : 1);
