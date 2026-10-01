// ---------------------------------------------------------------------------
// THE CAPTURE GATEWAY (Phase 4) - the architectural core.
// It wraps the host so that every tools/call, and every declared decision,
// becomes a hashed, chained receipt on the ledger session. The agent uses this
// wrapped host exactly like the raw one, so it never decides whether to record.
// ---------------------------------------------------------------------------
import { ActionType, TRUST } from "./ledger.js";

export function withLedger(host, session) {
  const owner = {};
  for (const t of host.allTools) owner[t.name] = t.server;

  return {
    allTools: host.allTools,
    session,

    // Same signature the agent already calls. We run the real tool, then record.
    async call(name, args) {
      const server = owner[name];
      const result = await host.call(name, args);
      session.record({
        actionType: ActionType.TOOL_CALL,
        input: { tool: name, args },
        output: result,
        metadata: { tool: name, system: server, trustDomain: TRUST[server] || "unknown" },
      });
      return result;
    },

    // The agent's declared reasoning, captured by the harness (not by the model
    // choosing to log). Recorded as a decision receipt in the same chain.
    recordDecision(text) {
      session.record({ actionType: ActionType.DECISION, input: {}, output: {}, reasoning: text });
    },

    closeAll: () => host.closeAll(),
  };
}
