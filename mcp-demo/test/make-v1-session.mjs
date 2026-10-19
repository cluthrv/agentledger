// Test helper: writes a v1 session the way the gateway signed sessions before v2
// (record/v1 and seal/v1 messages, v1 hashes and Merkle root), anchored in the
// rehearsal registry. Run in a test workspace with DEMO_MOCK=1 and no chain.
import fs from "node:fs";
import { AgentLedgerSession, ActionType } from "@vluthra/agent-ledger";
import { loadSigningKey, messages } from "../host/keys.js";
import { anchorRoot } from "../host/anchor.js";

const session = new AgentLedgerSession({ agentId: "sales-ops-agent", platform: "mcp" }); // v1 by default
session.record({ agentId: "sales-ops-agent", actionType: ActionType.DECISION, input: {}, output: {}, reasoning: "Recommendation: DECLINE." });
session.record({
  agentId: "sales-ops-agent",
  actionType: ActionType.TOOL_CALL,
  input: { tool: "create_credit_line", args: { customerId: "MER-100", amount: 2400000, approvalId: "APR-9382" } },
  output: { creditLineId: "CL-5678", status: "active" },
  metadata: { tool: "create_credit_line", system: "approval", trustDomain: "human:approval" },
});

const signer = loadSigningKey("gateway");
const sid = session.getSessionId();
const records = session.getRecords();
const recordSignatures = records.map((r) => signer.sign(messages.record("v1", sid, r.sequenceNumber, r.hash)));
const sealed = session.seal();
const seal = { kind: "seal", recordCount: records.length, root: sealed.merkleRoot, signedAt: new Date().toISOString() };
seal.signature = signer.sign(messages.checkpoint("v1", "seal", sid, seal.recordCount, seal.root));

const exp = {
  ...session.export(),
  provenance: { gateway: { keyId: signer.keyId, publicKey: signer.publicKey }, recordSignatures, checkpoints: [seal] },
};
exp.anchor = await anchorRoot(sid, sealed.merkleRoot);
fs.mkdirSync("data/sessions", { recursive: true });
fs.writeFileSync("data/sessions/session.json", JSON.stringify(exp, null, 2));
fs.rmSync("data/sessions/session.backup.json", { force: true });
console.log("v1 session written: " + sid);
