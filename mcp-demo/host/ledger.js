// Thin wrapper over the @vluthra/agent-ledger library (the repo's own build).
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
  // v2: canonical JSON over every nested field, RFC 6962 style Merkle tree.
  return new AgentLedgerSession({ agentId, initiator, platform: "mcp", canonicalization: "v2" });
}

export { ActionType };
