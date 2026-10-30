// Regenerates ts_lib_v2_session.json with the TypeScript library's own
// session.export() (run `npm run build` at the repo root first):
//   node python/tests/fixtures/make_ts_lib_session.js
// Unlike ts_v2_session.json (written by the MCP demo gateway, versions at the
// top level), this export carries canonicalization and merkle inside `session`.
const fs = require("fs");
const path = require("path");
const { AgentLedgerSession, ActionType } = require("../../../dist");

const s = new AgentLedgerSession({ agentId: "credit-agent", canonicalization: "v2", platform: "xlang" });
s.record({ agentId: "credit-agent", actionType: ActionType.DECISION, input: {}, output: {}, reasoning: "Recommend DECLINE. Score 580 < 650." });
s.record({
  agentId: "credit-agent",
  actionType: ActionType.TOOL_CALL,
  input: { tool: "create_credit_line", args: { customerId: "MER-100", amount: 2400000, approvalId: "APR-9382" } },
  output: { creditLineId: "CL-5678", status: "active", at: new Date("2026-10-30T12:00:00Z") },
  metadata: { tool: "create_credit_line", serverReceipt: { argsHash: "aa", signature: "sig" } },
});
s.record({ actionType: ActionType.QUERY, input: { q: "café — ü 😀" }, output: { rate: 1 / 3, big: 1e21, small: 1e-7 } });
s.seal();

const out = path.join(__dirname, "ts_lib_v2_session.json");
fs.writeFileSync(out, JSON.stringify(s.export(), null, 2) + "\n");
console.log("wrote", out);
