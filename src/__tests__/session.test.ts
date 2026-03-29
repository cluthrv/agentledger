import { AgentLedgerSession } from '../core/session';
import { ActionType, SessionStatus } from '../types';

describe('AgentLedgerSession', () => {
  function createTestSession() {
    return new AgentLedgerSession({
      agentId: 'pricing-agent',
      initiator: 'dealer-portal',
      platform: 'salesforce',
      metadata: { orgId: 'ORG-001' },
    });
  }

  function recordSampleActions(session: AgentLedgerSession, count = 3) {
    const actions = [
      {
        agentId: 'pricing-agent',
        actionType: ActionType.QUERY,
        input: { query: 'Get dealer tier for account ACC-100' },
        output: { tier: 'Gold', discountPct: 15 },
        reasoning: 'Queried account master to determine dealer classification',
      },
      {
        agentId: 'pricing-agent',
        actionType: ActionType.CALCULATION,
        input: { sku: 'SKU-1234', basePrice: 200, discountPct: 15 },
        output: { finalPrice: 170, savings: 30 },
        reasoning: 'Applied Gold tier discount of 15% to base price',
      },
      {
        agentId: 'pricing-agent',
        actionType: ActionType.VALIDATION,
        input: { finalPrice: 170, minimumPrice: 150, sku: 'SKU-1234' },
        output: { valid: true, margin: 20 },
        reasoning: 'Price exceeds minimum threshold; approved for quote generation',
      },
      {
        agentId: 'pricing-agent',
        actionType: ActionType.CREATE,
        input: { accountId: 'ACC-100', sku: 'SKU-1234', price: 170 },
        output: { quoteId: 'Q-5678', status: 'draft' },
        reasoning: 'Generated draft quote with validated pricing',
      },
      {
        agentId: 'pricing-agent',
        actionType: ActionType.ESCALATION,
        input: { quoteId: 'Q-5678', reason: 'Requires manager approval above $10k' },
        output: { escalatedTo: 'manager@company.com', notificationSent: true },
        reasoning: 'Quote total exceeds auto-approval threshold',
      },
    ];

    const results = [];
    for (let i = 0; i < Math.min(count, actions.length); i++) {
      results.push(session.record(actions[i]));
    }
    return results;
  }

  describe('session creation', () => {
    it('should create a session with a unique ID', () => {
      const s1 = createTestSession();
      const s2 = createTestSession();
      expect(s1.getSessionId()).not.toBe(s2.getSessionId());
    });

    it('should start in ACTIVE status', () => {
      const session = createTestSession();
      expect(session.getStatus()).toBe(SessionStatus.ACTIVE);
    });

    it('should capture session metadata', () => {
      const session = createTestSession();
      const audit = session.toAuditSession();
      expect(audit.agentId).toBe('pricing-agent');
      expect(audit.initiator).toBe('dealer-portal');
      expect(audit.platform).toBe('salesforce');
      expect(audit.metadata).toEqual({ orgId: 'ORG-001' });
    });
  });

  describe('recording actions', () => {
    it('should record actions with sequential numbers', () => {
      const session = createTestSession();
      const records = recordSampleActions(session, 3);

      expect(records[0].sequenceNumber).toBe(0);
      expect(records[1].sequenceNumber).toBe(1);
      expect(records[2].sequenceNumber).toBe(2);
    });

    it('should chain records via previousHash', () => {
      const session = createTestSession();
      const records = recordSampleActions(session, 3);

      expect(records[0].previousHash).toBeNull();
      expect(records[1].previousHash).toBe(records[0].hash);
      expect(records[2].previousHash).toBe(records[1].hash);
    });

    it('should assign the correct session ID to all records', () => {
      const session = createTestSession();
      const records = recordSampleActions(session, 3);
      const sessionId = session.getSessionId();

      records.forEach((r) => expect(r.sessionId).toBe(sessionId));
    });

    it('should update record count', () => {
      const session = createTestSession();
      recordSampleActions(session, 4);
      expect(session.toAuditSession().recordCount).toBe(4);
    });

    it('should prevent recording after sealing', () => {
      const session = createTestSession();
      recordSampleActions(session, 2);
      session.seal();

      expect(() => {
        session.record({
          agentId: 'pricing-agent',
          actionType: ActionType.QUERY,
          input: {},
          output: {},
        });
      }).toThrow('Cannot record actions');
    });
  });

  describe('sealing', () => {
    it('should seal a session and compute Merkle root', () => {
      const session = createTestSession();
      recordSampleActions(session, 3);
      const sealed = session.seal();

      expect(sealed.status).toBe(SessionStatus.SEALED);
      expect(sealed.merkleRoot).not.toBeNull();
      expect(sealed.merkleRoot).toHaveLength(64);
      expect(sealed.endTime).not.toBeNull();
    });

    it('should prevent double sealing', () => {
      const session = createTestSession();
      recordSampleActions(session, 2);
      session.seal();

      expect(() => session.seal()).toThrow('already sealed');
    });

    it('should prevent sealing an empty session', () => {
      const session = createTestSession();
      expect(() => session.seal()).toThrow('empty session');
    });

    it('should produce different roots for different action sequences', () => {
      const s1 = createTestSession();
      recordSampleActions(s1, 3);
      const sealed1 = s1.seal();

      const s2 = createTestSession();
      recordSampleActions(s2, 2);
      const sealed2 = s2.seal();

      expect(sealed1.merkleRoot).not.toBe(sealed2.merkleRoot);
    });
  });

  describe('verification', () => {
    it('should verify a valid sealed session', () => {
      const session = createTestSession();
      recordSampleActions(session, 5);
      session.seal();
      const result = session.verify();

      expect(result.valid).toBe(true);
      expect(result.checks.every((c) => c.passed)).toBe(true);
    });

    it('should verify an active (unsealed) session', () => {
      const session = createTestSession();
      recordSampleActions(session, 3);
      const result = session.verify();

      expect(result.valid).toBe(true);
      // Should not check Merkle root for active sessions
      expect(result.checks.find((c) => c.name === 'merkle_root_integrity')).toBeUndefined();
    });

    it('should transition to VERIFIED status after successful verification', () => {
      const session = createTestSession();
      recordSampleActions(session, 3);
      session.seal();
      session.verify();

      expect(session.getStatus()).toBe(SessionStatus.VERIFIED);
    });
  });

  describe('Merkle proofs', () => {
    it('should generate and verify proofs for all records', () => {
      const session = createTestSession();
      recordSampleActions(session, 5);
      session.seal();

      for (let i = 0; i < 5; i++) {
        const proof = session.proveRecord(i);
        expect(proof).not.toBeNull();
        expect(session.verifyProof(proof!)).toBe(true);
      }
    });

    it('should reject proofs for out-of-bounds indices', () => {
      const session = createTestSession();
      recordSampleActions(session, 3);
      session.seal();

      expect(session.proveRecord(-1)).toBeNull();
      expect(session.proveRecord(3)).toBeNull();
    });

    it('should throw if session is not sealed', () => {
      const session = createTestSession();
      recordSampleActions(session, 3);

      expect(() => session.proveRecord(0)).toThrow('Seal the session first');
    });
  });

  describe('export', () => {
    it('should export complete session data', () => {
      const session = createTestSession();
      recordSampleActions(session, 3);
      session.seal();

      const exported = session.export();
      expect(exported.session.sessionId).toBe(session.getSessionId());
      expect(exported.session.status).toBe(SessionStatus.SEALED);
      expect(exported.records).toHaveLength(3);
      expect(exported.records[0].sequenceNumber).toBe(0);
    });

    it('should return copies, not references', () => {
      const session = createTestSession();
      recordSampleActions(session, 2);

      const records1 = session.getRecords();
      const records2 = session.getRecords();
      expect(records1).not.toBe(records2);
      expect(records1).toEqual(records2);
    });
  });

  describe('real-world scenario: B2B pricing workflow', () => {
    it('should audit a complete dealer pricing session end-to-end', () => {
      // Simulate a real B2B commerce scenario
      const session = new AgentLedgerSession({
        agentId: 'cpq-pricing-agent',
        initiator: 'dealer-portal-user-123',
        platform: 'salesforce',
        metadata: { orgId: 'ORG-ACME', dealerId: 'DEALER-500' },
      });

      // Step 1: Agent queries dealer information
      session.record({
        agentId: 'cpq-pricing-agent',
        actionType: ActionType.QUERY,
        input: { dealerId: 'DEALER-500', fields: ['tier', 'region', 'creditStatus'] },
        output: { tier: 'Platinum', region: 'Midwest', creditStatus: 'approved' },
        reasoning: 'Retrieved dealer profile to determine applicable pricing rules',
      });

      // Step 2: Agent looks up product catalog
      session.record({
        agentId: 'cpq-pricing-agent',
        actionType: ActionType.QUERY,
        input: { skus: ['HYD-100', 'HYD-200', 'HYD-300'], catalog: 'dealer-2026' },
        output: {
          products: [
            { sku: 'HYD-100', basePrice: 5200, available: true },
            { sku: 'HYD-200', basePrice: 8400, available: true },
            { sku: 'HYD-300', basePrice: 12000, available: false },
          ],
        },
        reasoning: 'Queried current dealer catalog for requested SKUs',
      });

      // Step 3: Agent decides to flag unavailable product
      session.record({
        agentId: 'cpq-pricing-agent',
        actionType: ActionType.DECISION,
        input: { unavailableSku: 'HYD-300', dealerRequest: 'include all three' },
        output: { decision: 'exclude', substituteOffered: 'HYD-350' },
        reasoning: 'HYD-300 is discontinued; offering HYD-350 as substitute per product team guidance',
      });

      // Step 4: Agent calculates pricing
      session.record({
        agentId: 'cpq-pricing-agent',
        actionType: ActionType.CALCULATION,
        input: {
          items: [
            { sku: 'HYD-100', basePrice: 5200, qty: 10 },
            { sku: 'HYD-200', basePrice: 8400, qty: 5 },
          ],
          discountRules: { tier: 'Platinum', volumeThreshold: 50000 },
        },
        output: {
          subtotal: 94000,
          tierDiscount: 18800,
          volumeDiscount: 3760,
          finalTotal: 71440,
        },
        reasoning: 'Applied Platinum tier discount (20%) and volume discount (5% on orders over $50k)',
      });

      // Step 5: Agent validates against floor pricing
      session.record({
        agentId: 'cpq-pricing-agent',
        actionType: ActionType.VALIDATION,
        input: { finalTotal: 71440, floorTotal: 65000, margin: 6440 },
        output: { valid: true, approvalRequired: false },
        reasoning: 'Final total exceeds floor pricing; no additional approval needed',
      });

      // Step 6: Agent creates the quote
      session.record({
        agentId: 'cpq-pricing-agent',
        actionType: ActionType.CREATE,
        input: {
          dealerId: 'DEALER-500',
          items: ['HYD-100 x10', 'HYD-200 x5'],
          total: 71440,
        },
        output: { quoteId: 'Q-2026-0892', status: 'pending-review', expiresAt: '2026-04-28' },
        reasoning: 'Created dealer quote with 30-day validity',
      });

      // Seal and verify
      const sealed = session.seal();
      expect(sealed.recordCount).toBe(6);
      expect(sealed.merkleRoot).toHaveLength(64);

      const verification = session.verify();
      expect(verification.valid).toBe(true);
      expect(verification.checks.every((c) => c.passed)).toBe(true);

      // Verify individual record proof
      const proof = session.proveRecord(3); // the calculation step
      expect(proof).not.toBeNull();
      expect(session.verifyProof(proof!)).toBe(true);

      // Export for storage
      const exported = session.export();
      expect(exported.session.platform).toBe('salesforce');
      expect(exported.records).toHaveLength(6);
    });
  });
});
