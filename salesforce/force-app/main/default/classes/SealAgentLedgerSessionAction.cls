/**
 * SealAgentLedgerSessionAction
 *
 * Invocable Action exposed to Agentforce and Flow. Seals an
 * AgentLedger session by computing its Merkle root. Once sealed,
 * no further actions can be recorded against the session. Call
 * this last, after all decisions and actions for the agent run
 * have been recorded — and before delivering the final response
 * to the user.
 */
public with sharing class SealAgentLedgerSessionAction {

    public class Request {
        @InvocableVariable(label='Session Id' description='The sessionId returned by Start AgentLedger Session.' required=true)
        public Id sessionId;
    }

    public class Result {
        @InvocableVariable(label='Merkle Root' description='The computed Merkle root for the sealed session. A 64-character SHA-256 hex string.')
        public String merkleRoot;

        @InvocableVariable(label='Success')
        public Boolean success;

        @InvocableVariable(label='Error Message')
        public String errorMessage;
    }

    @InvocableMethod(
        label='Seal AgentLedger Session'
        description='Seals the session and computes the Merkle root. Call this last, after all decisions and actions are recorded, before responding to the user.'
        category='AgentLedger'
    )
    public static List<Result> execute(List<Request> requests) {
        List<Result> results = new List<Result>();

        for (Request req : requests) {
            Result res = new Result();
            try {
                if (req.sessionId == null) {
                    res.success = false;
                    res.errorMessage = 'Session Id is required.';
                    results.add(res);
                    continue;
                }

                String merkleRoot = AgentAuditRecorder.sealSession(req.sessionId);

                res.merkleRoot = merkleRoot;
                res.success    = true;
            } catch (Exception ex) {
                res.success = false;
                res.errorMessage = ex.getMessage();
            }
            results.add(res);
        }

        return results;
    }
}