@isTest
private class AgentLedgerDemoControllerTest {

    @isTest
    static void testStartDemoSession() {
        Id sessionId = AgentLedgerDemoController.startDemoSession();
        System.assertNotEquals(null, sessionId);

        Agent_Audit_Session__c session = [
            SELECT Agent_Id__c, Status__c FROM Agent_Audit_Session__c WHERE Id = :sessionId
        ];
        System.assertEquals('cpq-pricing-agent', session.Agent_Id__c);
        System.assertEquals('Active', session.Status__c);
    }

    @isTest
    static void testExecuteAllSteps() {
        Id sessionId = AgentLedgerDemoController.startDemoSession();

        for (Integer i = 0; i <= 8; i++) {
            AgentLedgerDemoController.StepResult result =
                AgentLedgerDemoController.executeStep(sessionId, i);

            System.assertNotEquals(null, result.recordId, 'Step ' + i + ' should create a record');
            System.assertNotEquals(null, result.recordHash, 'Step ' + i + ' should have a hash');
            System.assertEquals(i, result.sequenceNumber, 'Step ' + i + ' sequence mismatch');
            System.assertNotEquals(null, result.label, 'Step ' + i + ' should have a label');

            if (i == 0) {
                System.assertEquals(null, result.previousHash, 'First record should have null prev hash');
            } else {
                System.assertNotEquals(null, result.previousHash, 'Step ' + i + ' should chain to previous');
            }
        }
    }

    @isTest
    static void testSealDemoSession() {
        Id sessionId = AgentLedgerDemoController.startDemoSession();

        for (Integer i = 0; i <= 8; i++) {
            AgentLedgerDemoController.executeStep(sessionId, i);
        }

        AgentLedgerDemoController.SealResult sealResult =
            AgentLedgerDemoController.sealDemoSession(sessionId);

        System.assertNotEquals(null, sealResult.merkleRoot);
        System.assertEquals(64, sealResult.merkleRoot.length());
        System.assertEquals(9, sealResult.recordCount);
    }

    @isTest
    static void testVerifyDemoSession() {
        Id sessionId = AgentLedgerDemoController.startDemoSession();

        for (Integer i = 0; i <= 8; i++) {
            AgentLedgerDemoController.executeStep(sessionId, i);
        }

        AgentLedgerDemoController.sealDemoSession(sessionId);

        AgentAuditRecorder.VerifySessionResult result =
            AgentLedgerDemoController.verifyDemoSession(sessionId);

        System.assert(result.valid, 'Session should verify: ' + result.message);
    }

    @isTest
    static void testGenerateRecordProof() {
        Id sessionId = AgentLedgerDemoController.startDemoSession();

        for (Integer i = 0; i <= 8; i++) {
            AgentLedgerDemoController.executeStep(sessionId, i);
        }

        AgentLedgerDemoController.sealDemoSession(sessionId);

        AgentLedgerDemoController.ProofResult proof =
            AgentLedgerDemoController.generateRecordProof(sessionId, 5);

        System.assertNotEquals(null, proof);
        System.assertEquals(5, proof.recordIndex);
        System.assert(proof.isValid, 'Proof should be valid');
    }

    @isTest
    static void testGetRecords() {
        Id sessionId = AgentLedgerDemoController.startDemoSession();

        for (Integer i = 0; i <= 8; i++) {
            AgentLedgerDemoController.executeStep(sessionId, i);
        }

        List<Agent_Audit_Record__c> records =
            AgentLedgerDemoController.getRecords(sessionId);

        System.assertEquals(9, records.size());
    }
}
