const { AgentLedgerSession, ActionType } = require('./dist');

// Create an audit session for a CPQ pricing agent
const session = new AgentLedgerSession({
  agentId: 'cpq-pricing-agent',
  platform: 'salesforce',
  initiator: 'dealer-portal-user',
  metadata: { orgId: 'ACME-001', dealerId: 'DEALER-500' }
});

console.log('\n=== AgentLedger Demo: B2B Dealer Pricing Session ===\n');
console.log(`Session ID: ${session.getSessionId()}`);
console.log(`Status: ${session.getStatus()}\n`);

// Record agent actions
const r1 = session.record({
  agentId: 'cpq-pricing-agent',
  actionType: ActionType.QUERY,
  input: { dealerId: 'DEALER-500' },
  output: { tier: 'Platinum', region: 'Midwest' },
  reasoning: 'Retrieved dealer profile for pricing rules'
});
console.log(`Action 1 [QUERY]: Hash ${r1.hash.substring(0, 20)}...`);

const r2 = session.record({
  agentId: 'cpq-pricing-agent',
  actionType: ActionType.CALCULATION,
  input: { basePrice: 5200, qty: 10, discountPct: 20 },
  output: { subtotal: 52000, discount: 10400, total: 41600 },
  reasoning: 'Applied Platinum tier 20% discount'
});
console.log(`Action 2 [CALC]:  Hash ${r2.hash.substring(0, 20)}...`);
console.log(`  Chain link: previousHash matches Action 1? ${r2.previousHash === r1.hash}`);

const r3 = session.record({
  agentId: 'cpq-pricing-agent',
  actionType: ActionType.VALIDATION,
  input: { total: 41600, floorPrice: 36400 },
  output: { valid: true, margin: 5200 },
  reasoning: 'Price exceeds floor; approved'
});
console.log(`Action 3 [VALID]: Hash ${r3.hash.substring(0, 20)}...`);
console.log(`  Chain link: previousHash matches Action 2? ${r3.previousHash === r2.hash}`);

// Seal the session
console.log('\n--- Sealing Session ---');
const sealed = session.seal();
console.log(`Status: ${sealed.status}`);
console.log(`Merkle Root: ${sealed.merkleRoot}`);
console.log(`Records: ${sealed.recordCount}`);

// Verify everything
console.log('\n--- Verification ---');
const result = session.verify();
console.log(`Result: ${result.valid ? 'PASSED' : 'FAILED'}`);
result.checks.forEach(c => {
  console.log(`  ${c.passed ? 'PASS' : 'FAIL'} ${c.name}: ${c.detail}`);
});

// Prove a single record
console.log('\n--- Merkle Proof for Action 2 (the pricing calculation) ---');
const proof = session.proveRecord(1);
console.log(`Record hash: ${proof.recordHash.substring(0, 20)}...`);
console.log(`Proof siblings: ${proof.siblings.length}`);
console.log(`Proof valid: ${session.verifyProof(proof)}`);

// Show tamper detection
console.log('\n--- Tamper Detection Demo ---');
const tamperedProof = { ...proof, recordHash: 'tampered-hash-value' };
console.log(`Tampered proof valid: ${session.verifyProof(tamperedProof)}`);
console.log('(AgentLedger detected the tampering)\n');
