/**
 * RecordAuditTrailController
 *
 * Provides data for the recordAuditTrail LWC component that sits on
 * any Salesforce record page (Opportunity, Account, Case, etc.) and
 * displays the AgentLedger audit trail for that specific record.
 */
public with sharing class RecordAuditTrailController {

    /**
     * Get all audit sessions related to a specific Salesforce record.
     * @param recordId The Salesforce record Id (e.g., an Opportunity Id)
     * @return List of sessions with their audit records
     */
    @AuraEnabled(cacheable=true)
    public static List<SessionSummary> getSessionsForRecord(String recordId) {
        List<SessionSummary> summaries = new List<SessionSummary>();

        List<Agent_Audit_Session__c> sessions = [
            SELECT Id, Name, Session_Id__c, Agent_Id__c, Merkle_Root__c,
                   Status__c, Record_Count__c, Initiator__c, Platform__c,
                   Start_Time__c, End_Time__c, Related_Record_Id__c
            FROM Agent_Audit_Session__c
            WHERE Related_Record_Id__c = :recordId
            ORDER BY Start_Time__c DESC
        ];

        for (Agent_Audit_Session__c session : sessions) {
            SessionSummary summary = new SessionSummary();
            summary.sessionId = session.Id;
            summary.sessionName = session.Name;
            summary.agentId = session.Agent_Id__c;
            summary.merkleRoot = session.Merkle_Root__c;
            summary.status = session.Status__c;
            summary.recordCount = Integer.valueOf(session.Record_Count__c);
            summary.initiator = session.Initiator__c;
            summary.startTime = session.Start_Time__c;
            summary.endTime = session.End_Time__c;

            // Get the audit records for this session
            List<Agent_Audit_Record__c> records = [
                SELECT Id, Name, Sequence_Number__c, Action_Timestamp__c,
                       Agent_Id__c, Action_Type__c, Input_Context__c,
                       Output_Result__c, Reasoning__c, Record_Hash__c,
                       Previous_Hash__c
                FROM Agent_Audit_Record__c
                WHERE Audit_Session__c = :session.Id
                ORDER BY Sequence_Number__c ASC
            ];

            summary.records = new List<AuditRecordInfo>();
            for (Agent_Audit_Record__c rec : records) {
                AuditRecordInfo info = new AuditRecordInfo();
                info.recordId = rec.Id;
                info.sequenceNumber = Integer.valueOf(rec.Sequence_Number__c);
                info.actionType = rec.Action_Type__c;
                info.reasoning = rec.Reasoning__c;
                info.recordHash = rec.Record_Hash__c;
                info.previousHash = rec.Previous_Hash__c;
                info.timestamp = rec.Action_Timestamp__c;
                summary.records.add(info);
            }

            summaries.add(summary);
        }

        return summaries;
    }

    /**
     * Verify a specific session from the record page.
     */
    @AuraEnabled
    public static AgentAuditRecorder.VerifySessionResult verifySessionFromRecord(Id sessionId) {
        return AgentAuditRecorder.verifySession(sessionId);
    }

    public class SessionSummary {
        @AuraEnabled public Id sessionId;
        @AuraEnabled public String sessionName;
        @AuraEnabled public String agentId;
        @AuraEnabled public String merkleRoot;
        @AuraEnabled public String status;
        @AuraEnabled public Integer recordCount;
        @AuraEnabled public String initiator;
        @AuraEnabled public DateTime startTime;
        @AuraEnabled public DateTime endTime;
        @AuraEnabled public List<AuditRecordInfo> records;
    }

    public class AuditRecordInfo {
        @AuraEnabled public Id recordId;
        @AuraEnabled public Integer sequenceNumber;
        @AuraEnabled public String actionType;
        @AuraEnabled public String reasoning;
        @AuraEnabled public String recordHash;
        @AuraEnabled public String previousHash;
        @AuraEnabled public DateTime timestamp;
    }
}
