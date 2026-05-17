/**
 * AuditedSealSession
 *
 * Agentforce Invocable Action: Seals an AgentLedger session by
 * computing the Merkle root and locking the audit trail.
 * Call this at the end of an agent workflow.
 */
public with sharing class AuditedSealSession {

    @InvocableMethod(label='Seal Audited Session'
                     description='Seals the AgentLedger session with a Merkle root. No further actions can be recorded after sealing.'
                     category='AgentLedger')
    public static List<Output> execute(List<Input> inputs) {
        List<Output> outputs = new List<Output>();

        for (Input inp : inputs) {
            String merkleRoot = AgentAuditRecorder.sealSession(inp.sessionId);

            Agent_Audit_Session__c session = [
                SELECT Name, Record_Count__c
                FROM Agent_Audit_Session__c
                WHERE Id = :inp.sessionId
            ];

            // Auto-verify after sealing
            AgentAuditRecorder.VerifySessionResult verifyResult =
                AgentAuditRecorder.verifySession(inp.sessionId);

            Output out = new Output();
            out.merkleRoot = merkleRoot;
            out.recordCount = Integer.valueOf(session.Record_Count__c);
            out.verified = verifyResult.valid;
            out.summary = 'Session sealed with ' + out.recordCount + ' records. Merkle root: '
                + merkleRoot.substring(0, 16) + '... Verification: '
                + (verifyResult.valid ? 'PASSED' : 'FAILED');

            outputs.add(out);
        }

        return outputs;
    }

    public class Input {
        @InvocableVariable(label='Session ID' required=true)
        public Id sessionId;
    }

    public class Output {
        @InvocableVariable(label='Merkle Root') public String merkleRoot;
        @InvocableVariable(label='Record Count') public Integer recordCount;
        @InvocableVariable(label='Verified') public Boolean verified;
        @InvocableVariable(label='Summary') public String summary;
    }
}
