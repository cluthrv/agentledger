/**
 * VerifyAgentLedgerSessionAction
 *
 * Invocable Action exposed to Agentforce and Flow. Verifies the
 * integrity of a sealed AgentLedger session by recomputing the hash
 * chain and Merkle root and comparing them to the stored values.
 * Optional in the standard agent flow — sealing already establishes
 * the session as tamper-evident. Use this when an agent or user
 * explicitly needs to confirm a session has not been altered.
 */
public with sharing class VerifyAgentLedgerSessionAction {

    public class Request {
        @InvocableVariable(label='Session Id' description='The session to verify.' required=true)
        public Id sessionId;
    }

    public class Result {
        @InvocableVariable(label='Valid' description='True if the hash chain and Merkle root are intact.')
        public Boolean valid;

        @InvocableVariable(label='Message' description='Human-readable verification summary.')
        public String message;

        @InvocableVariable(label='Success')
        public Boolean success;

        @InvocableVariable(label='Error Message')
        public String errorMessage;
    }

    @InvocableMethod(
        label='Verify AgentLedger Session'
        description='Verifies the hash chain and Merkle root of a sealed session. Returns whether the session is intact or has been tampered with.'
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

                AgentAuditRecorder.VerifySessionResult verifyResult =
                    AgentAuditRecorder.verifySession(req.sessionId);

                res.valid   = verifyResult.valid;
                res.message = verifyResult.message;
                res.success = true;
            } catch (Exception ex) {
                res.success = false;
                res.errorMessage = ex.getMessage();
            }
            results.add(res);
        }

        return results;
    }
}