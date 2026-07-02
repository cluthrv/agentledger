/**
 * AgentLedgerActionsTest
 *
 * Test coverage for the four AgentLedger Invocable Actions used by
 * Agentforce and Flow:
 *   - StartAgentLedgerSessionAction
 *   - RecordAgentActionAction
 *   - SealAgentLedgerSessionAction
 *   - VerifyAgentLedgerSessionAction
 *
 * Also covers HashChainService (hashActionRecord, verifyChain broken-chain
 * detection) and MerkleTreeService (computeMerkleRoot edge cases).
 *
 * Covers success paths, validation/error paths, the exception path, and
 * the full start -> record -> seal -> verify lifecycle.
 */
@isTest
private class AgentLedgerActionsTest {

    // ── Helper: start a session through the action and return its Id ──
    private static Id startViaAction(String agentId, String relatedRecordId) {
        StartAgentLedgerSessionAction.Request req =
            new StartAgentLedgerSessionAction.Request();
        req.agentId = agentId;
        req.relatedRecordId = relatedRecordId;
        req.platform = 'salesforce';

        List<StartAgentLedgerSessionAction.Result> results =
            StartAgentLedgerSessionAction.execute(
                new List<StartAgentLedgerSessionAction.Request>{ req });

        System.assertEquals(1, results.size());
        System.assert(results[0].success, 'Start failed: ' + results[0].errorMessage);
        System.assertNotEquals(null, results[0].sessionId);
        return results[0].sessionId;
    }

    // ════════════════════════════════════════════════════════════
    // StartAgentLedgerSessionAction
    // ════════════════════════════════════════════════════════════

    @isTest
    static void testStartSuccess() {
        Test.startTest();
        Id sessionId = startViaAction('opportunity-qualification-agent', '006000000000001');
        Test.stopTest();

        Agent_Audit_Session__c s = [
            SELECT Agent_Id__c, Related_Record_Id__c, Platform__c, Status__c
            FROM Agent_Audit_Session__c WHERE Id = :sessionId
        ];
        System.assertEquals('opportunity-qualification-agent', s.Agent_Id__c);
        System.assertEquals('006000000000001', s.Related_Record_Id__c);
        System.assertEquals('salesforce', s.Platform__c);
        System.assertEquals('Active', s.Status__c);
    }

    @isTest
    static void testStartMissingAgentId() {
        StartAgentLedgerSessionAction.Request req =
            new StartAgentLedgerSessionAction.Request();
        req.agentId = '';
        req.relatedRecordId = '006000000000001';

        List<StartAgentLedgerSessionAction.Result> results =
            StartAgentLedgerSessionAction.execute(
                new List<StartAgentLedgerSessionAction.Request>{ req });

        System.assertEquals(false, results[0].success);
        System.assertNotEquals(null, results[0].errorMessage);
    }

    @isTest
    static void testStartMissingRelatedRecordId() {
        StartAgentLedgerSessionAction.Request req =
            new StartAgentLedgerSessionAction.Request();
        req.agentId = 'agent-x';
        req.relatedRecordId = '';

        List<StartAgentLedgerSessionAction.Result> results =
            StartAgentLedgerSessionAction.execute(
                new List<StartAgentLedgerSessionAction.Request>{ req });

        System.assertEquals(false, results[0].success);
        System.assertNotEquals(null, results[0].errorMessage);
    }

    @isTest
    static void testStartDefaultsPlatform() {
        StartAgentLedgerSessionAction.Request req =
            new StartAgentLedgerSessionAction.Request();
        req.agentId = 'agent-x';
        req.relatedRecordId = '006000000000009';
        req.platform = null; // should default to 'salesforce'

        List<StartAgentLedgerSessionAction.Result> results =
            StartAgentLedgerSessionAction.execute(
                new List<StartAgentLedgerSessionAction.Request>{ req });

        System.assert(results[0].success, 'Start failed: ' + results[0].errorMessage);
        Agent_Audit_Session__c s = [
            SELECT Platform__c FROM Agent_Audit_Session__c
            WHERE Id = :results[0].sessionId
        ];
        System.assertEquals('salesforce', s.Platform__c);
    }

    @isTest
    static void testStartExceptionPath() {
        // Related_Record_Id__c is Text(18); a 300-char value forces a
        // StringException on insert, exercising the catch block.
        StartAgentLedgerSessionAction.Request req =
            new StartAgentLedgerSessionAction.Request();
        req.agentId = 'agent-x';
        req.relatedRecordId = 'x'.repeat(300);
        req.platform = 'salesforce';

        List<StartAgentLedgerSessionAction.Result> results =
            StartAgentLedgerSessionAction.execute(
                new List<StartAgentLedgerSessionAction.Request>{ req });

        System.assertEquals(false, results[0].success);
        System.assertNotEquals(null, results[0].errorMessage);
    }

    @isTest
    static void testStartBulk() {
        List<StartAgentLedgerSessionAction.Request> reqs =
            new List<StartAgentLedgerSessionAction.Request>();
        for (Integer i = 0; i < 3; i++) {
            StartAgentLedgerSessionAction.Request r =
                new StartAgentLedgerSessionAction.Request();
            r.agentId = 'bulk-agent-' + i;
            r.relatedRecordId = '00600000000000' + i;
            r.platform = 'salesforce';
            reqs.add(r);
        }
        List<StartAgentLedgerSessionAction.Result> results =
            StartAgentLedgerSessionAction.execute(reqs);
        System.assertEquals(3, results.size());
        for (StartAgentLedgerSessionAction.Result res : results) {
            System.assert(res.success, 'Bulk start failed: ' + res.errorMessage);
        }
    }

    // ════════════════════════════════════════════════════════════
    // RecordAgentActionAction
    // ════════════════════════════════════════════════════════════

    @isTest
    static void testRecordSuccess() {
        Id sessionId = startViaAction('agent-1', '006000000000002');

        RecordAgentActionAction.Request req = new RecordAgentActionAction.Request();
        req.sessionId = sessionId;
        req.agentId = 'agent-1';
        req.actionType = 'Query';
        req.inputContext = '{"field":"Amount"}';
        req.outputResult = '{"amount":275000}';
        req.reasoning = 'Retrieved the Opportunity amount for qualification.';

        List<RecordAgentActionAction.Result> results =
            RecordAgentActionAction.execute(
                new List<RecordAgentActionAction.Request>{ req });

        System.assert(results[0].success, 'Record failed: ' + results[0].errorMessage);
        System.assertNotEquals(null, results[0].auditRecordId);
        System.assertNotEquals(null, results[0].recordHash);
        System.assertEquals(0, results[0].sequenceNumber);
    }

    @isTest
    static void testRecordInvalidActionType() {
        Id sessionId = startViaAction('agent-1', '006000000000003');

        RecordAgentActionAction.Request req = new RecordAgentActionAction.Request();
        req.sessionId = sessionId;
        req.agentId = 'agent-1';
        req.actionType = 'NotARealType';
        req.reasoning = 'x';

        List<RecordAgentActionAction.Result> results =
            RecordAgentActionAction.execute(
                new List<RecordAgentActionAction.Request>{ req });

        System.assertEquals(false, results[0].success);
        System.assertNotEquals(null, results[0].errorMessage);
    }

    @isTest
    static void testRecordMissingSessionId() {
        RecordAgentActionAction.Request req = new RecordAgentActionAction.Request();
        req.sessionId = null;
        req.agentId = 'agent-1';
        req.actionType = 'Query';
        req.reasoning = 'x';

        List<RecordAgentActionAction.Result> results =
            RecordAgentActionAction.execute(
                new List<RecordAgentActionAction.Request>{ req });

        System.assertEquals(false, results[0].success);
    }

    @isTest
    static void testRecordMissingReasoning() {
        Id sessionId = startViaAction('agent-1', '006000000000004');

        RecordAgentActionAction.Request req = new RecordAgentActionAction.Request();
        req.sessionId = sessionId;
        req.agentId = 'agent-1';
        req.actionType = 'Decision';
        req.reasoning = '';

        List<RecordAgentActionAction.Result> results =
            RecordAgentActionAction.execute(
                new List<RecordAgentActionAction.Request>{ req });

        System.assertEquals(false, results[0].success);
    }

    @isTest
    static void testRecordMissingAgentId() {
        Id sessionId = startViaAction('agent-1', '006000000000012');

        RecordAgentActionAction.Request req = new RecordAgentActionAction.Request();
        req.sessionId = sessionId;
        req.agentId = '';
        req.actionType = 'Query';
        req.reasoning = 'Missing agent id.';

        List<RecordAgentActionAction.Result> results =
            RecordAgentActionAction.execute(
                new List<RecordAgentActionAction.Request>{ req });

        System.assertEquals(false, results[0].success);
    }

    // ════════════════════════════════════════════════════════════
    // SealAgentLedgerSessionAction
    // ════════════════════════════════════════════════════════════

    @isTest
    static void testSealSuccess() {
        Id sessionId = startViaAction('agent-2', '006000000000005');

        RecordAgentActionAction.Request rec = new RecordAgentActionAction.Request();
        rec.sessionId = sessionId;
        rec.agentId = 'agent-2';
        rec.actionType = 'Query';
        rec.reasoning = 'Recorded a step before sealing.';
        RecordAgentActionAction.execute(
            new List<RecordAgentActionAction.Request>{ rec });

        Test.startTest();
        SealAgentLedgerSessionAction.Request seal =
            new SealAgentLedgerSessionAction.Request();
        seal.sessionId = sessionId;
        List<SealAgentLedgerSessionAction.Result> results =
            SealAgentLedgerSessionAction.execute(
                new List<SealAgentLedgerSessionAction.Request>{ seal });
        Test.stopTest();

        System.assert(results[0].success, 'Seal failed: ' + results[0].errorMessage);
        System.assertNotEquals(null, results[0].merkleRoot);
        System.assertEquals(64, results[0].merkleRoot.length());
    }

    @isTest
    static void testSealMissingSessionId() {
        SealAgentLedgerSessionAction.Request seal =
            new SealAgentLedgerSessionAction.Request();
        seal.sessionId = null;

        List<SealAgentLedgerSessionAction.Result> results =
            SealAgentLedgerSessionAction.execute(
                new List<SealAgentLedgerSessionAction.Request>{ seal });

        System.assertEquals(false, results[0].success);
    }

    // ════════════════════════════════════════════════════════════
    // VerifyAgentLedgerSessionAction
    // ════════════════════════════════════════════════════════════

    @isTest
    static void testVerifySuccess() {
        Id sessionId = startViaAction('agent-3', '006000000000006');

        RecordAgentActionAction.Request rec = new RecordAgentActionAction.Request();
        rec.sessionId = sessionId;
        rec.agentId = 'agent-3';
        rec.actionType = 'Decision';
        rec.reasoning = 'Final decision recorded.';
        RecordAgentActionAction.execute(
            new List<RecordAgentActionAction.Request>{ rec });

        SealAgentLedgerSessionAction.Request seal =
            new SealAgentLedgerSessionAction.Request();
        seal.sessionId = sessionId;
        SealAgentLedgerSessionAction.execute(
            new List<SealAgentLedgerSessionAction.Request>{ seal });

        Test.startTest();
        VerifyAgentLedgerSessionAction.Request ver =
            new VerifyAgentLedgerSessionAction.Request();
        ver.sessionId = sessionId;
        List<VerifyAgentLedgerSessionAction.Result> results =
            VerifyAgentLedgerSessionAction.execute(
                new List<VerifyAgentLedgerSessionAction.Request>{ ver });
        Test.stopTest();

        System.assert(results[0].success, 'Verify failed: ' + results[0].errorMessage);
        System.assert(results[0].valid, 'Invalid: ' + results[0].message);
    }

    @isTest
    static void testVerifyMissingSessionId() {
        VerifyAgentLedgerSessionAction.Request ver =
            new VerifyAgentLedgerSessionAction.Request();
        ver.sessionId = null;

        List<VerifyAgentLedgerSessionAction.Result> results =
            VerifyAgentLedgerSessionAction.execute(
                new List<VerifyAgentLedgerSessionAction.Request>{ ver });

        System.assertEquals(false, results[0].success);
    }

    // ════════════════════════════════════════════════════════════
    // Full lifecycle through the action layer
    // ════════════════════════════════════════════════════════════

    @isTest
    static void testFullLifecycleThroughActions() {
        Id sessionId = startViaAction('lifecycle-agent', '006000000000007');

        for (String t : new List<String>{ 'Query', 'Validation', 'Decision' }) {
            RecordAgentActionAction.Request rec =
                new RecordAgentActionAction.Request();
            rec.sessionId = sessionId;
            rec.agentId = 'lifecycle-agent';
            rec.actionType = t;
            rec.inputContext = '{"step":"' + t + '"}';
            rec.outputResult = '{"ok":true}';
            rec.reasoning = 'Step for ' + t;
            List<RecordAgentActionAction.Result> recRes =
                RecordAgentActionAction.execute(
                    new List<RecordAgentActionAction.Request>{ rec });
            System.assert(recRes[0].success, 'Rec failed: ' + recRes[0].errorMessage);
        }

        SealAgentLedgerSessionAction.Request seal =
            new SealAgentLedgerSessionAction.Request();
        seal.sessionId = sessionId;
        List<SealAgentLedgerSessionAction.Result> sealRes =
            SealAgentLedgerSessionAction.execute(
                new List<SealAgentLedgerSessionAction.Request>{ seal });
        System.assert(sealRes[0].success, 'Seal failed: ' + sealRes[0].errorMessage);

        VerifyAgentLedgerSessionAction.Request ver =
            new VerifyAgentLedgerSessionAction.Request();
        ver.sessionId = sessionId;
        List<VerifyAgentLedgerSessionAction.Result> verRes =
            VerifyAgentLedgerSessionAction.execute(
                new List<VerifyAgentLedgerSessionAction.Request>{ ver });
        System.assert(verRes[0].valid, 'Verify failed: ' + verRes[0].message);

        Agent_Audit_Session__c s = [
            SELECT Status__c, Record_Count__c
            FROM Agent_Audit_Session__c WHERE Id = :sessionId
        ];
        System.assertEquals(3, s.Record_Count__c);
    }

    // ════════════════════════════════════════════════════════════
    // HashChainService coverage
    // ════════════════════════════════════════════════════════════

    @isTest
    static void testHashActionRecordOverload() {
        Agent_Audit_Record__c rec = new Agent_Audit_Record__c(
            Sequence_Number__c = 0,
            Action_Timestamp__c = DateTime.now(),
            Agent_Id__c = 'agent-x',
            Action_Type__c = 'Query',
            Input_Context__c = '{"a":1}',
            Output_Result__c = '{"b":2}',
            Reasoning__c = 'test reasoning',
            Previous_Hash__c = ''
        );
        String h = HashChainService.hashActionRecord(rec);
        System.assertEquals(64, h.length(), 'Hash should be 64 hex chars');
    }

    @isTest
    static void testVerifyChainDetectsTamperedHash() {
        Id sessionId = startViaAction('chain-agent', '006000000000010');

        RecordAgentActionAction.Request rec = new RecordAgentActionAction.Request();
        rec.sessionId = sessionId;
        rec.agentId = 'chain-agent';
        rec.actionType = 'Query';
        rec.reasoning = 'first record';
        RecordAgentActionAction.execute(
            new List<RecordAgentActionAction.Request>{ rec });

        Agent_Audit_Record__c stored = [
            SELECT Id, Record_Hash__c FROM Agent_Audit_Record__c
            WHERE Audit_Session__c = :sessionId LIMIT 1
        ];
        stored.Record_Hash__c = 'deadbeef' + '0'.repeat(56);
        update stored;

        List<Agent_Audit_Record__c> records = [
            SELECT Id, Name, Audit_Session__c, Sequence_Number__c, Action_Timestamp__c,
                   Agent_Id__c, Action_Type__c, Input_Context__c, Output_Result__c,
                   Reasoning__c, Previous_Hash__c, Record_Hash__c
            FROM Agent_Audit_Record__c WHERE Audit_Session__c = :sessionId
            ORDER BY Sequence_Number__c ASC
        ];
        HashChainService.VerificationResult result =
            HashChainService.verifyChain(records);
        System.assertEquals(false, result.valid, 'Tampered hash should fail');
        System.assertNotEquals(null, result.errors);
    }

    @isTest
    static void testVerifyChainDetectsBrokenLink() {
        Id sessionId = startViaAction('chain-agent2', '006000000000011');

        for (Integer i = 0; i < 2; i++) {
            RecordAgentActionAction.Request rec = new RecordAgentActionAction.Request();
            rec.sessionId = sessionId;
            rec.agentId = 'chain-agent2';
            rec.actionType = 'Query';
            rec.reasoning = 'record ' + i;
            RecordAgentActionAction.execute(
                new List<RecordAgentActionAction.Request>{ rec });
        }

        List<Agent_Audit_Record__c> recs = [
            SELECT Id, Sequence_Number__c, Previous_Hash__c
            FROM Agent_Audit_Record__c WHERE Audit_Session__c = :sessionId
            ORDER BY Sequence_Number__c ASC
        ];
        recs[1].Previous_Hash__c = 'wronghash' + '0'.repeat(55);
        update recs[1];

        List<Agent_Audit_Record__c> records = [
            SELECT Id, Name, Audit_Session__c, Sequence_Number__c, Action_Timestamp__c,
                   Agent_Id__c, Action_Type__c, Input_Context__c, Output_Result__c,
                   Reasoning__c, Previous_Hash__c, Record_Hash__c
            FROM Agent_Audit_Record__c WHERE Audit_Session__c = :sessionId
            ORDER BY Sequence_Number__c ASC
        ];
        HashChainService.VerificationResult result =
            HashChainService.verifyChain(records);
        System.assertEquals(false, result.valid, 'Broken link should fail');
    }

    @isTest
    static void testVerifyChainEmpty() {
        HashChainService.VerificationResult result =
            HashChainService.verifyChain(new List<Agent_Audit_Record__c>());
        System.assertEquals(true, result.valid, 'Empty chain should be valid');
    }

    // ════════════════════════════════════════════════════════════
    // MerkleTreeService coverage
    // ════════════════════════════════════════════════════════════

    @isTest
    static void testComputeMerkleRootSingleLeaf() {
        String root = MerkleTreeService.computeMerkleRoot(
            new List<String>{ 'a'.repeat(64) });
        System.assertEquals(64, root.length());
    }

    @isTest
    static void testComputeMerkleRootOddLeaves() {
        String root = MerkleTreeService.computeMerkleRoot(new List<String>{
            'a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)
        });
        System.assertEquals(64, root.length());
    }

    @isTest
    static void testComputeMerkleRootEmpty() {
        String root = MerkleTreeService.computeMerkleRoot(new List<String>());
        System.assertEquals(null, root, 'Empty list returns null root');
    }
}