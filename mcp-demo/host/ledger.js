// Thin wrapper over the published @vluthra/agent-ledger library.
import { AgentLedgerSession, ActionType } from "@vluthra/agent-ledger";

// Which trust domain each MCP server belongs to. This is what makes the
// cross-trust story visible in the data.
export const TRUST = {
  crm:      "external:salesforce",
  bureau:   "external:credit-bureau",
  finance:  "internal:finance",
  policy:   "internal:policy",
  approval: "human:approval",
};

export function startSession({ agentId = "sales-ops-agent", initiator = "demo-user" } = {}) {
  return new AgentLedgerSession({ agentId, initiator, platform: "mcp" });
}

export { ActionType };
