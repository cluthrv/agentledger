/**
 * AgentLedger — Real-World Integration Example
 *
 * This example simulates how AgentLedger would integrate with an actual
 * AI agent (e.g., LangChain, CrewAI, or Salesforce Agentforce) performing
 * a B2B dealer pricing workflow.
 *
 * In production, you would replace the simulated agent functions with
 * actual LLM calls and database queries.
 *
 * Usage: node examples/real-world-pricing-agent.js
 */

const { AgentLedgerSession, ActionType } = require('../dist');
const fs = require('fs');

// ─────────────────────────────────────────────────
// SIMULATED EXTERNAL SYSTEMS (replace with real APIs)
// ─────────────────────────────────────────────────

/** Simulates a CRM database lookup */
function crmLookup(dealerId) {
  const dealers = {
    'DEALER-100': { name: 'Midwest Heavy Equipment', tier: 'Platinum', region: 'Midwest', creditLimit: 500000, creditStatus: 'approved' },
    'DEALER-200': { name: 'Pacific Coast Hydraulics', tier: 'Gold', region: 'West', creditLimit: 250000, creditStatus: 'approved' },
    'DEALER-300': { name: 'Southeast Industrial', tier: 'Silver', region: 'Southeast', creditLimit: 100000, creditStatus: 'under_review' },
  };
  return dealers[dealerId] || null;
}

/** Simulates a CPQ product catalog query */
function cpqCatalogQuery(skus) {
  const catalog = {
    'HYD-100': { name: 'Hydraulic Cylinder 100mm', basePrice: 5200, weight: 45, available: true },
    'HYD-200': { name: 'Hydraulic Pump Assembly', basePrice: 8400, weight: 32, available: true },
    'HYD-300': { name: 'Hydraulic Control Valve', basePrice: 3100, weight: 12, available: true },
    'HYD-400': { name: 'Hydraulic Hose Kit', basePrice: 890, weight: 8, available: true },
    'HYD-500': { name: 'Hydraulic Filter Set', basePrice: 420, weight: 3, available: false },
  };
  return skus.map(sku => ({ sku, ...catalog[sku] })).filter(p => p.name);
}

/** Simulates discount rules from the pricing engine */
function getPricingRules(tier) {
  const rules = {
    'Platinum': { tierDiscount: 0.20, volumeThreshold: 50000, volumeDiscount: 0.05, maxDiscount: 0.30 },
    'Gold': { tierDiscount: 0.15, volumeThreshold: 75000, volumeDiscount: 0.03, maxDiscount: 0.22 },
    'Silver': { tierDiscount: 0.10, volumeThreshold: 100000, volumeDiscount: 0.02, maxDiscount: 0.15 },
  };
  return rules[tier] || null;
}

/** Simulates floor price validation */
function validateFloorPricing(items) {
  // Floor price is 60% of base price (40% max margin giveaway)
  return items.map(item => ({
    sku: item.sku,
    unitPrice: item.unitPrice,
    floorPrice: item.basePrice * 0.60,
    passed: item.unitPrice >= item.basePrice * 0.60,
  }));
}

// ─────────────────────────────────────────────────
// THE AI AGENT (with AgentLedger instrumentation)
// ─────────────────────────────────────────────────

async function runPricingAgent(dealerId, orderRequest) {
  console.log('\n' + '═'.repeat(60));
  console.log('  AgentLedger — AI Pricing Agent (Real-World Simulation)');
  console.log('═'.repeat(60));

  // Initialize AgentLedger session
  const session = new AgentLedgerSession({
    agentId: 'cpq-pricing-agent-v2',
    platform: 'salesforce',
    initiator: `dealer-portal:${dealerId}`,
    metadata: {
      orgId: 'ORG-ACME-PROD',
      environment: 'production',
      apiVersion: '61.0',
      requestId: `REQ-${Date.now()}`,
    },
  });

  console.log(`\nSession: ${session.getSessionId()}`);
  console.log(`Dealer: ${dealerId}`);
  console.log(`Request: ${orderRequest.skus.length} SKUs, quantities: [${orderRequest.quantities.join(', ')}]`);

  // ── STEP 1: Look up dealer information ──
  console.log('\n── Step 1: Dealer Lookup ──');
  const dealer = crmLookup(dealerId);

  session.record({
    agentId: 'cpq-pricing-agent-v2',
    actionType: ActionType.QUERY,
    input: { system: 'CRM', query: 'dealer_profile', dealerId },
    output: dealer || { error: 'Dealer not found' },
    reasoning: dealer
      ? `Retrieved dealer profile. ${dealer.name} is a ${dealer.tier} tier dealer in the ${dealer.region} region.`
      : `Dealer ${dealerId} not found in CRM system.`,
  });

  if (!dealer) {
    console.log(`  ERROR: Dealer ${dealerId} not found. Aborting.`);
    return null;
  }
  console.log(`  Found: ${dealer.name} (${dealer.tier} tier, ${dealer.region})`);

  // ── STEP 2: Credit check ──
  console.log('\n── Step 2: Credit Validation ──');

  const creditDecision = dealer.creditStatus === 'approved' ? 'proceed' : 'escalate';
  session.record({
    agentId: 'cpq-pricing-agent-v2',
    actionType: ActionType.VALIDATION,
    input: { creditStatus: dealer.creditStatus, creditLimit: dealer.creditLimit },
    output: { decision: creditDecision, reason: creditDecision === 'proceed' ? 'Credit approved' : 'Credit under review — requires manual approval' },
    reasoning: `Dealer credit status is "${dealer.creditStatus}". ${creditDecision === 'proceed' ? 'Proceeding with quote generation.' : 'Escalating to credit team for manual review before quote can be finalized.'}`,
  });

  if (creditDecision === 'escalate') {
    console.log(`  ESCALATE: Credit status "${dealer.creditStatus}" requires review.`);

    session.record({
      agentId: 'cpq-pricing-agent-v2',
      actionType: ActionType.ESCALATION,
      input: { dealerId, reason: 'credit_review_required' },
      output: { escalatedTo: 'credit-review-queue', ticket: `CR-${Date.now()}` },
      reasoning: 'Credit not approved. Escalating to credit review team. Quote will be held in draft status pending approval.',
    });

    const sealed = session.seal();
    console.log(`\n  Session sealed (escalated). Merkle root: ${sealed.merkleRoot.substring(0, 32)}...`);
    return { status: 'escalated', session: session.export() };
  }
  console.log(`  Credit approved. Limit: $${dealer.creditLimit.toLocaleString()}`);

  // ── STEP 3: Product catalog lookup ──
  console.log('\n── Step 3: Product Catalog Query ──');
  const products = cpqCatalogQuery(orderRequest.skus);
  const unavailable = products.filter(p => !p.available);
  const available = products.filter(p => p.available);

  session.record({
    agentId: 'cpq-pricing-agent-v2',
    actionType: ActionType.QUERY,
    input: { system: 'CPQ', query: 'product_catalog', skus: orderRequest.skus },
    output: { found: products.length, available: available.length, unavailable: unavailable.map(p => p.sku) },
    reasoning: `Queried CPQ catalog for ${orderRequest.skus.length} SKUs. ${available.length} available, ${unavailable.length} unavailable.`,
  });

  available.forEach(p => console.log(`  ✓ ${p.sku}: ${p.name} — $${p.basePrice}`));
  unavailable.forEach(p => console.log(`  ✗ ${p.sku}: ${p.name} — UNAVAILABLE`));

  // ── STEP 4: Handle unavailable products ──
  if (unavailable.length > 0) {
    console.log('\n── Step 4: Unavailable Product Decision ──');

    session.record({
      agentId: 'cpq-pricing-agent-v2',
      actionType: ActionType.DECISION,
      input: { unavailableSkus: unavailable.map(p => p.sku), dealerPreference: 'exclude_unavailable' },
      output: { action: 'excluded', excludedSkus: unavailable.map(p => p.sku), note: 'Dealer will be notified of unavailable items' },
      reasoning: `${unavailable.length} requested SKU(s) not available. Excluding from quote per standard policy. Dealer will receive notification with restock estimates.`,
    });

    console.log(`  Excluded ${unavailable.length} unavailable SKU(s) from quote.`);
  }

  // ── STEP 5: Retrieve pricing rules ──
  console.log('\n── Step 5: Pricing Rules ──');
  const rules = getPricingRules(dealer.tier);

  session.record({
    agentId: 'cpq-pricing-agent-v2',
    actionType: ActionType.QUERY,
    input: { system: 'CPQ', query: 'pricing_rules', tier: dealer.tier },
    output: rules,
    reasoning: `Retrieved ${dealer.tier} tier pricing rules. Base discount: ${(rules.tierDiscount * 100)}%, volume threshold: $${rules.volumeThreshold.toLocaleString()}, max discount cap: ${(rules.maxDiscount * 100)}%.`,
  });

  console.log(`  Tier discount: ${(rules.tierDiscount * 100)}%`);
  console.log(`  Volume threshold: $${rules.volumeThreshold.toLocaleString()} (additional ${(rules.volumeDiscount * 100)}%)`);
  console.log(`  Max discount cap: ${(rules.maxDiscount * 100)}%`);

  // ── STEP 6: Calculate pricing ──
  console.log('\n── Step 6: Price Calculation ──');

  const lineItems = available.map((product, idx) => {
    const qty = orderRequest.quantities[orderRequest.skus.indexOf(product.sku)] || 1;
    const lineTotal = product.basePrice * qty;
    return { sku: product.sku, name: product.name, basePrice: product.basePrice, qty, lineTotal };
  });

  const subtotal = lineItems.reduce((sum, item) => sum + item.lineTotal, 0);
  const tierDiscountAmount = subtotal * rules.tierDiscount;
  const qualifiesForVolume = subtotal >= rules.volumeThreshold;
  const volumeDiscountAmount = qualifiesForVolume ? subtotal * rules.volumeDiscount : 0;
  const totalDiscount = tierDiscountAmount + volumeDiscountAmount;
  const effectiveRate = totalDiscount / subtotal;
  const cappedRate = Math.min(effectiveRate, rules.maxDiscount);
  const finalDiscount = subtotal * cappedRate;
  const finalTotal = subtotal - finalDiscount;

  session.record({
    agentId: 'cpq-pricing-agent-v2',
    actionType: ActionType.CALCULATION,
    input: {
      lineItems: lineItems.map(li => ({ sku: li.sku, qty: li.qty, basePrice: li.basePrice })),
      tierDiscount: rules.tierDiscount,
      volumeDiscount: qualifiesForVolume ? rules.volumeDiscount : 0,
      maxDiscountCap: rules.maxDiscount,
    },
    output: {
      subtotal,
      tierDiscountAmount: Math.round(tierDiscountAmount * 100) / 100,
      volumeQualified: qualifiesForVolume,
      volumeDiscountAmount: Math.round(volumeDiscountAmount * 100) / 100,
      effectiveDiscountRate: Math.round(cappedRate * 10000) / 100,
      finalDiscount: Math.round(finalDiscount * 100) / 100,
      finalTotal: Math.round(finalTotal * 100) / 100,
    },
    reasoning: `Subtotal: $${subtotal.toLocaleString()}. Applied ${dealer.tier} tier discount (${(rules.tierDiscount * 100)}% = $${tierDiscountAmount.toLocaleString()}). ${qualifiesForVolume ? `Order exceeds volume threshold of $${rules.volumeThreshold.toLocaleString()}; applied additional ${(rules.volumeDiscount * 100)}% volume discount ($${volumeDiscountAmount.toLocaleString()}).` : `Order below volume threshold of $${rules.volumeThreshold.toLocaleString()}; no volume discount applied.`} Effective rate: ${(cappedRate * 100).toFixed(1)}%${effectiveRate > rules.maxDiscount ? ` (capped from ${(effectiveRate * 100).toFixed(1)}%)` : ''}. Final total: $${finalTotal.toLocaleString()}.`,
  });

  lineItems.forEach(li => console.log(`  ${li.sku}: ${li.qty} × $${li.basePrice} = $${li.lineTotal.toLocaleString()}`));
  console.log(`  Subtotal: $${subtotal.toLocaleString()}`);
  console.log(`  Discount: -$${Math.round(finalDiscount).toLocaleString()} (${(cappedRate * 100).toFixed(1)}%)`);
  console.log(`  Final: $${Math.round(finalTotal).toLocaleString()}`);

  // ── STEP 7: Floor price validation ──
  console.log('\n── Step 7: Floor Price Validation ──');

  const itemsWithPricing = lineItems.map(li => ({
    sku: li.sku,
    basePrice: li.basePrice,
    unitPrice: li.basePrice * (1 - cappedRate),
  }));
  const floorCheck = validateFloorPricing(itemsWithPricing);
  const allPassed = floorCheck.every(f => f.passed);

  session.record({
    agentId: 'cpq-pricing-agent-v2',
    actionType: ActionType.VALIDATION,
    input: { items: floorCheck.map(f => ({ sku: f.sku, unitPrice: Math.round(f.unitPrice * 100) / 100, floorPrice: Math.round(f.floorPrice * 100) / 100 })) },
    output: { allPassed, results: floorCheck.map(f => ({ sku: f.sku, passed: f.passed })) },
    reasoning: allPassed
      ? 'All line items pass floor price validation. No items are priced below the minimum margin threshold.'
      : `Floor price violation detected. ${floorCheck.filter(f => !f.passed).map(f => f.sku).join(', ')} priced below minimum.`,
  });

  floorCheck.forEach(f => {
    const status = f.passed ? '✓ PASS' : '✗ FAIL';
    console.log(`  ${status}: ${f.sku} — unit $${Math.round(f.unitPrice)} vs floor $${Math.round(f.floorPrice)}`);
  });

  // ── STEP 8: Check credit limit ──
  console.log('\n── Step 8: Credit Limit Check ──');

  const withinLimit = finalTotal <= dealer.creditLimit;
  session.record({
    agentId: 'cpq-pricing-agent-v2',
    actionType: ActionType.VALIDATION,
    input: { orderTotal: Math.round(finalTotal * 100) / 100, creditLimit: dealer.creditLimit },
    output: { withinLimit, headroom: Math.round((dealer.creditLimit - finalTotal) * 100) / 100 },
    reasoning: withinLimit
      ? `Order total ($${Math.round(finalTotal).toLocaleString()}) is within credit limit ($${dealer.creditLimit.toLocaleString()}). Headroom: $${Math.round(dealer.creditLimit - finalTotal).toLocaleString()}.`
      : `Order total ($${Math.round(finalTotal).toLocaleString()}) exceeds credit limit ($${dealer.creditLimit.toLocaleString()}) by $${Math.round(finalTotal - dealer.creditLimit).toLocaleString()}. Escalation required.`,
  });

  console.log(`  Order: $${Math.round(finalTotal).toLocaleString()} | Limit: $${dealer.creditLimit.toLocaleString()} | ${withinLimit ? '✓ Within limit' : '✗ EXCEEDS LIMIT'}`);

  // ── STEP 9: Create the quote ──
  console.log('\n── Step 9: Quote Generation ──');

  const quoteId = `Q-2026-${String(Math.floor(Math.random() * 9000) + 1000)}`;
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  session.record({
    agentId: 'cpq-pricing-agent-v2',
    actionType: ActionType.CREATE,
    input: {
      dealerId,
      dealerName: dealer.name,
      lineItems: lineItems.map(li => ({ sku: li.sku, qty: li.qty, unitPrice: Math.round(li.basePrice * (1 - cappedRate) * 100) / 100 })),
      total: Math.round(finalTotal * 100) / 100,
    },
    output: {
      quoteId,
      status: 'pending_review',
      expiresAt,
      pdfGenerated: true,
    },
    reasoning: `Generated quote ${quoteId} for ${dealer.name}. ${lineItems.length} line items, total $${Math.round(finalTotal).toLocaleString()}. Quote valid for 30 days (expires ${expiresAt}). Status set to pending_review per standard workflow.`,
  });

  console.log(`  Quote ID: ${quoteId}`);
  console.log(`  Status: pending_review`);
  console.log(`  Expires: ${expiresAt}`);

  // ── SEAL & VERIFY ──
  console.log('\n' + '─'.repeat(60));
  console.log('  SEALING & VERIFYING SESSION');
  console.log('─'.repeat(60));

  const sealed = session.seal();
  console.log(`\n  Status: ${sealed.status}`);
  console.log(`  Records: ${sealed.recordCount}`);
  console.log(`  Merkle Root: ${sealed.merkleRoot}`);

  const verification = session.verify();
  console.log(`\n  Verification: ${verification.valid ? '✓ PASSED' : '✗ FAILED'}`);
  verification.checks.forEach(c => {
    console.log(`    ${c.passed ? '✓' : '✗'} ${c.name}: ${c.detail}`);
  });

  // ── MERKLE PROOFS ──
  console.log('\n' + '─'.repeat(60));
  console.log('  MERKLE PROOF DEMO');
  console.log('─'.repeat(60));

  // Prove the pricing calculation step (useful if dealer disputes the price)
  const calcRecordIndex = 5; // The CALCULATION step
  const calcRecord = session.getRecord(calcRecordIndex);
  const proof = session.proveRecord(calcRecordIndex);

  console.log(`\n  Generating proof for record ${calcRecordIndex} (${calcRecord.actionType})...`);
  console.log(`  Record hash: ${calcRecord.hash.substring(0, 40)}...`);
  console.log(`  Proof siblings: ${proof.siblings.length}`);
  console.log(`  Proof valid against root: ${session.verifyProof(proof)}`);
  console.log(`\n  This proves the pricing calculation is part of the sealed`);
  console.log(`  session without revealing any other records in the session.`);

  // ── EXPORT SESSION ──
  console.log('\n' + '─'.repeat(60));
  console.log('  EXPORTING SESSION');
  console.log('─'.repeat(60));

  const exported = session.export();
  const exportPath = 'examples/audit-session-output.json';
  fs.writeFileSync(exportPath, JSON.stringify(exported, null, 2));
  console.log(`\n  Full session exported to: ${exportPath}`);
  console.log(`  File size: ${(fs.statSync(exportPath).size / 1024).toFixed(1)} KB`);
  console.log(`  Contains: ${exported.records.length} action records + session metadata`);
  console.log(`\n  This JSON file is what would be stored in your audit database,`);
  console.log(`  sent to a compliance system, or provided to an auditor.\n`);

  return { status: 'completed', quoteId, session: exported };
}

// ─────────────────────────────────────────────────
// RUN THE AGENT
// ─────────────────────────────────────────────────

// Scenario 1: Successful Platinum dealer order
runPricingAgent('DEALER-100', {
  skus: ['HYD-100', 'HYD-200', 'HYD-300', 'HYD-400', 'HYD-500'],
  quantities: [10, 5, 20, 50, 100],
}).then(() => {
  console.log('═'.repeat(60));
  console.log('  Demo complete. Check examples/audit-session-output.json');
  console.log('  for the full exported audit trail.');
  console.log('═'.repeat(60) + '\n');
});