/**
 * AgentLedgerTest
 *
 * Comprehensive test suite for HashChainService, MerkleTreeService,
 * and AgentAuditRecorder. Covers hash computation, chain verification,
 * Merkle tree operations, session lifecycle, and tamper detection.
 */
@isTest
private class AgentLedgerTest {

    // ── HashChainService Tests ──

    @isTest
    static void testSha256ProducesValidHash() {
        String hash = HashChainService.sha256('hello');
        System.assertEquals(64, hash.length(), 'SHA-256 should produce 64-char hex string');
        System.assert(hash.isAlphanumeric(), 'Hash should be alphanumeric hex');
    }

    @isTest
    static void testSha256IsDeterministic() {
        String hash1 = HashChainService.sha256('test-data');
        String hash2 = HashChainService.sha256('test-data');
        System.assertEquals(hash1, hash2, 'Same input should produce same hash');
    }

    @isTest
    static void testSha256DifferentInputsDifferentHashes() {
        String hash1 = HashChainService.sha256('input-a');
        String hash2 = HashChainService.sha256('input-b');
        System.assertNotEquals(hash1, hash2, 'Different inputs should produce different hashes');
    }

    @isTest
    static void testCombineHashesIsOrderDependent() {
        String ab = HashChainService.combineHashes('hash-a', 'hash-b');
        String ba = HashChainService.combineHashes('hash-b', 'hash-a');
        System.assertNotEquals(ab, ba, 'Hash combination should be order-dependent');
    }

    // ── MerkleTreeService Tests ──

    @isTest
    static void testMerkleRootEmptyInput() {
        String root = MerkleTreeService.computeMerkleRoot(new List<String>());
        System.assertEquals(null, root, 'Empty input should return null');
    }

    @isTest
    static void testMerkleRootSingleHash() {
        String root = MerkleTreeService.computeMerkleRoot(new List<String>{'hash-a'});
        System.assertNotEquals(null, root, 'Single hash should produce a root');
        System.assertEquals(64, root.length(), 'Root should be 64-char hex');
    }

    @isTest
    static void testMerkleRootIsDeterministic() {
        List<String> hashes = new List<String>{'aaa', 'bbb', 'ccc', 'ddd'};
        String root1 = MerkleTreeService.computeMerkleRoot(hashes);
        String root2 = MerkleTreeService.computeMerkleRoot(hashes);
        System.assertEquals(root1, root2, 'Same hashes should produce same root');
    }

    @isTest
    static void testMerkleRootChangesWithDifferentInput() {
        String root1 = MerkleTreeService.computeMerkleRoot(new List<String>{'a', 'b', 'c'});
        String root2 = MerkleTreeService.computeMerkleRoot(new List<String>{'a', 'b', 'd'});
        System.assertNotEquals(root1, root2, 'Different hashes should produce different roots');
    }

    @isTest
    static void testMerkleRootIsOrderSensitive() {
        String root1 = MerkleTreeService.computeMerkleRoot(new List<String>{'a', 'b', 'c'});
        String root2 = MerkleTreeService.computeMerkleRoot(new List<String>{'c', 'b', 'a'});
        System.assertNotEquals(root1, root2, 'Different order should produce different roots');
    }

    @isTest
    static void testMerkleProofGeneration() {
        List<String> hashes = new List<String>{'rec-0', 'rec-1', 'rec-2', 'rec-3'};

        for (Integer i = 0; i < hashes.size(); i++) {
            MerkleTreeService.MerkleProof proof = MerkleTreeService.generateProof(hashes, i);
            System.assertNotEquals(null, proof, 'Proof should not be null for valid index');
            System.assertEquals(i, proof.recordIndex, 'Record index should match');
            System.assertEquals(hashes[i], proof.recordHash, 'Record hash should match');
            System.assert(!proof.siblings.isEmpty(), 'Proof should have siblings');
        }
    }

    @isTest
    static void testMerkleProofOutOfBounds() {
        List<String> hashes = new List<String>{'a', 'b', 'c'};
        System.assertEquals(null, MerkleTreeService.generateProof(hashes, -1));
        System.assertEquals(null, MerkleTreeService.generateProof(hashes, 3));
        System.assertEquals(null, MerkleTreeService.generateProof(hashes, 100));
    }

    @isTest
    static void testMerkleProofVerification() {
        List<String> hashes = new List<String>{'alpha', 'beta', 'gamma', 'delta'};

        for (Integer i = 0; i < hashes.size(); i++) {
            MerkleTreeService.MerkleProof proof = MerkleTreeService.generateProof(hashes, i);
            System.assert(MerkleTreeService.verifyProof(proof),
                'Valid proof should verify for index ' + i);
        }
    }

    @isTest
    static void testMerkleProofRejectsTamperedHash() {
        List<String> hashes = new List<String>{'a', 'b', 'c', 'd'};
        MerkleTreeService.MerkleProof proof = MerkleTreeService.generateProof(hashes, 1);
        proof.recordHash = 'tampered-hash';
        System.assert(!MerkleTreeService.verifyProof(proof),
            'Tampered proof should fail verification');
    }

    @isTest
    static void testMerkleProofRejectsTamperedRoot() {
        List<String> hashes = new List<String>{'a', 'b', 'c', 'd'};
        MerkleTreeService.MerkleProof proof = MerkleTreeService.generateProof(hashes, 2);
        proof.root = 'fake-root';
        System.assert(!MerkleTreeService.verifyProof(proof),
            'Proof with tampered root should fail');
    }

    // ── AgentAuditRecorder Integration Tests ──

    @isTest
    static void testStartSession() {
        Id sessionId = AgentAuditRecorder.startSession(
            'test-agent', 'unit-test', 'salesforce'
        );

        Agent_Audit_Session__c session = [
            SELECT Agent_Id__c, Status__c, Initiator__c, Platform__c
            FROM Agent_Audit_Session__c
            WHERE Id = :sessionId
        ];

        System.assertEquals('test-agent', session.Agent_Id__c);
        System.assertEquals('Active', session.Status__c);
        System.assertEquals('unit-test', session.Initiator__c);
        System.assertEquals('salesforce', session.Platform__c);
    }

    @isTest
    static void testRecordAction() {
        Id sessionId = AgentAuditRecorder.startSession('test-agent', 'test', 'salesforce');

        Agent_Audit_Record__c record = AgentAuditRecorder.recordAction(
            sessionId, 'test-agent', 'Query',
            '{"query":"get price"}', '{"price":100}',
            'Retrieved base price'
        );

        System.assertNotEquals(null, record.Id);
        System.assertEquals(0, record.Sequence_Number__c);
        System.assertEquals('Query', record.Action_Type__c);
        System.assertNotEquals(null, record.Record_Hash__c);
        System.assertEquals(null, record.Previous_Hash__c);
    }

    @isTest
    static void testRecordChaining() {
        Id sessionId = AgentAuditRecorder.startSession('test-agent', 'test', 'salesforce');

        Agent_Audit_Record__c r1 = AgentAuditRecorder.recordAction(
            sessionId, 'test-agent', 'Query',
            '{"q":"first"}', '{"r":"first"}', 'First action'
        );

        Agent_Audit_Record__c r2 = AgentAuditRecorder.recordAction(
            sessionId, 'test-agent', 'Calculation',
            '{"q":"second"}', '{"r":"second"}', 'Second action'
        );

        // Reload r2 to get the Previous_Hash__c
        r2 = [SELECT Previous_Hash__c, Record_Hash__c, Sequence_Number__c
              FROM Agent_Audit_Record__c WHERE Id = :r2.Id];

        System.assertEquals(1, r2.Sequence_Number__c);
        System.assertEquals(r1.Record_Hash__c, r2.Previous_Hash__c,
            'Second record should chain to first record hash');
    }

    @isTest
    static void testSealSession() {
        Id sessionId = AgentAuditRecorder.startSession('test-agent', 'test', 'salesforce');

        AgentAuditRecorder.recordAction(sessionId, 'test-agent', 'Query',
            '{"q":"test"}', '{"r":"test"}', 'Test action 1');
        AgentAuditRecorder.recordAction(sessionId, 'test-agent', 'Create',
            '{"q":"test2"}', '{"r":"test2"}', 'Test action 2');

        String merkleRoot = AgentAuditRecorder.sealSession(sessionId);

        System.assertNotEquals(null, merkleRoot);
        System.assertEquals(64, merkleRoot.length());

        Agent_Audit_Session__c session = [
            SELECT Status__c, Merkle_Root__c, Record_Count__c
            FROM Agent_Audit_Session__c WHERE Id = :sessionId
        ];

        System.assertEquals('Sealed', session.Status__c);
        System.assertEquals(merkleRoot, session.Merkle_Root__c);
        System.assertEquals(2, session.Record_Count__c);
    }

    @isTest
    static void testSealEmptySessionThrows() {
        Id sessionId = AgentAuditRecorder.startSession('test-agent', 'test', 'salesforce');

        try {
            AgentAuditRecorder.sealSession(sessionId);
            System.assert(false, 'Should have thrown exception');
        } catch (MerkleTreeService.AgentLedgerException e) {
            System.assert(e.getMessage().contains('empty session'));
        }
    }

    @isTest
    static void testRecordAfterSealThrows() {
        Id sessionId = AgentAuditRecorder.startSession('test-agent', 'test', 'salesforce');
        AgentAuditRecorder.recordAction(sessionId, 'test-agent', 'Query',
            '{"q":"test"}', '{"r":"test"}', 'Action');
        AgentAuditRecorder.sealSession(sessionId);

        try {
            AgentAuditRecorder.recordAction(sessionId, 'test-agent', 'Query',
                '{"q":"post-seal"}', '{"r":"blocked"}', 'Should fail');
            System.assert(false, 'Should have thrown exception');
        } catch (MerkleTreeService.AgentLedgerException e) {
            System.assert(e.getMessage().contains('Sealed'));
        }
    }

    @isTest
    static void testVerifySession() {
        Id sessionId = AgentAuditRecorder.startSession('test-agent', 'test', 'salesforce');

        AgentAuditRecorder.recordAction(sessionId, 'test-agent', 'Query',
            '{"q":"1"}', '{"r":"1"}', 'Action 1');
        AgentAuditRecorder.recordAction(sessionId, 'test-agent', 'Calculation',
            '{"q":"2"}', '{"r":"2"}', 'Action 2');
        AgentAuditRecorder.recordAction(sessionId, 'test-agent', 'Create',
            '{"q":"3"}', '{"r":"3"}', 'Action 3');

        AgentAuditRecorder.sealSession(sessionId);

        AgentAuditRecorder.VerifySessionResult result =
            AgentAuditRecorder.verifySession(sessionId);

        System.assert(result.valid, 'Sealed session should verify: ' + result.message);

        for (AgentAuditRecorder.VerificationCheck check : result.checks) {
            System.assert(check.passed, check.name + ' failed: ' + check.detail);
        }
    }

    @isTest
    static void testGetSessionRecords() {
        Id sessionId = AgentAuditRecorder.startSession('test-agent', 'test', 'salesforce');

        AgentAuditRecorder.recordAction(sessionId, 'test-agent', 'Query',
            '{}', '{}', 'R1');
        AgentAuditRecorder.recordAction(sessionId, 'test-agent', 'Update',
            '{}', '{}', 'R2');

        List<Agent_Audit_Record__c> records =
            AgentAuditRecorder.getSessionRecords(sessionId);

        System.assertEquals(2, records.size());
        System.assertEquals(0, records[0].Sequence_Number__c);
        System.assertEquals(1, records[1].Sequence_Number__c);
    }

    @isTest
    static void testRunDemo() {
        Id sessionId = AgentAuditRecorder.runDemo();

        Agent_Audit_Session__c session = [
            SELECT Status__c, Merkle_Root__c, Record_Count__c
            FROM Agent_Audit_Session__c WHERE Id = :sessionId
        ];

        System.assertEquals('Sealed', session.Status__c);
        System.assertEquals(7, session.Record_Count__c);
        System.assertNotEquals(null, session.Merkle_Root__c);
    }

    @isTest
    static void testGenerateProofFromSession() {
        Id sessionId = AgentAuditRecorder.runDemo();

        MerkleTreeService.MerkleProof proof =
            AgentAuditRecorder.generateProof(sessionId, 3);

        System.assertNotEquals(null, proof);
        System.assertEquals(3, proof.recordIndex);
        System.assert(MerkleTreeService.verifyProof(proof),
            'Proof should verify against session root');
    }
}
