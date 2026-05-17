@isTest
private class RecordAuditTrailControllerTest {

    @isTest
    static void testGetSessionsForRecord() {
        // Create a session linked to a fake record Id
        Id sessionId = AgentAuditRecorder.startSession(
            'test-agent', 'test', 'salesforce'
        );

        // Link it to a record
        Agent_Audit_Session__c session = [
            SELECT Id FROM Agent_Audit_Session__c WHERE Id = :sessionId
        ];
        session.Related_Record_Id__c = '001000000000001';
        update session;

        // Add a record
        AgentAuditRecorder.recordAction(sessionId, 'test-agent', 'Query',
            '{}', '{}', 'Test action');

        // Query
        List<RecordAuditTrailController.SessionSummary> results =
            RecordAuditTrailController.getSessionsForRecord('001000000000001');

        System.assertEquals(1, results.size());
        System.assertEquals(1, results[0].records.size());
    }

    @isTest
    static void testVerifySessionFromRecord() {
        Id sessionId = AgentAuditRecorder.startSession(
            'test-agent', 'test', 'salesforce'
        );
        AgentAuditRecorder.recordAction(sessionId, 'test-agent', 'Query',
            '{}', '{}', 'Test');
        AgentAuditRecorder.sealSession(sessionId);

        AgentAuditRecorder.VerifySessionResult result =
            RecordAuditTrailController.verifySessionFromRecord(sessionId);

        System.assert(result.valid);
    }

    @isTest
    static void testNoSessionsForRecord() {
        List<RecordAuditTrailController.SessionSummary> results =
            RecordAuditTrailController.getSessionsForRecord('001000000000099');
        System.assertEquals(0, results.size());
    }
}
