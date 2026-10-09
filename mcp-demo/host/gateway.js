// ---------------------------------------------------------------------------
// THE CAPTURE GATEWAY (Phase 4) - the architectural core.
// It wraps the host so that every tools/call, and every declared decision,
// becomes a hashed, chained receipt on the ledger session. The agent uses this
// wrapped host exactly like the raw one, so it never decides whether to record.
//
// The gateway also signs: every record hash (so a receipt proves who recorded
// it), a checkpoint of the running Merkle root every CHECKPOINT_EVERY records
// (so a long or crashed session still has signed commitments), and the final
// seal. Each tools/call result goes back with its receipt in _meta.
// ---------------------------------------------------------------------------
import fs from "node:fs";
import path from "node:path";
import { computeMerkleRoot } from "@vluthra/agent-ledger";
import { ActionType, TRUST } from "./ledger.js";
import { loadSigningKey, messages, RECEIPT_META_KEY, SERVER_RECEIPT_META_KEY } from "./keys.js";

export function withLedger(host, session, {
  signer = loadSigningKey("gateway"),
  checkpointEvery = Number(process.env.CHECKPOINT_EVERY ?? 5),
} = {}) {
  const owner = {};
  for (const t of host.allTools) owner[t.name] = t.server;

  const sessionId = session.getSessionId();
  const recordSignatures = [];
  const checkpoints = [];
  // Checkpoints are also appended to disk as they happen, so they survive a crash.
  const checkpointLog = path.join("data", "checkpoints", sessionId + ".jsonl");

  function checkpoint(kind) {
    const hashes = session.getRecords().map((r) => r.hash);
    const root = computeMerkleRoot(hashes);
    const cp = { kind, recordCount: hashes.length, root, signedAt: new Date().toISOString() };
    cp.signature = signer.sign(messages.checkpoint(kind, sessionId, cp.recordCount, root));
    checkpoints.push(cp);
    fs.mkdirSync(path.dirname(checkpointLog), { recursive: true });
    fs.appendFileSync(checkpointLog, JSON.stringify(cp) + "\n");
    return cp;
  }

  function recordAndSign(input) {
    const rec = session.record(input);
    const signature = signer.sign(messages.record(sessionId, rec.sequenceNumber, rec.hash));
    recordSignatures.push(signature);
    if (checkpointEvery > 0 && (rec.sequenceNumber + 1) % checkpointEvery === 0) checkpoint("checkpoint");
    return { rec, signature };
  }

  // Run the real tool, record it, and return the MCP result with our receipt in _meta.
  async function callTool(name, args) {
    const server = owner[name];
    const raw = await host.callTool(name, args);
    const serverReceipt = raw._meta?.[SERVER_RECEIPT_META_KEY];
    const { rec, signature } = recordAndSign({
      actionType: ActionType.TOOL_CALL,
      input: { tool: name, args },
      output: JSON.parse(raw.content[0].text),
      metadata: { tool: name, system: server, trustDomain: TRUST[server] || "unknown", ...(serverReceipt && { serverReceipt }) },
    });
    const receipt = { sessionId, seq: rec.sequenceNumber, hash: rec.hash, previousHash: rec.previousHash, keyId: signer.keyId, signature };
    return { ...raw, _meta: { ...raw._meta, [RECEIPT_META_KEY]: receipt } };
  }

  return {
    allTools: host.allTools,
    session,
    callTool,

    // Same signature the agent already calls.
    async call(name, args) {
      return JSON.parse((await callTool(name, args)).content[0].text);
    },

    // The agent's declared reasoning, captured by the harness (not by the model
    // choosing to log). Recorded as a decision receipt in the same chain.
    recordDecision(text) {
      recordAndSign({ actionType: ActionType.DECISION, input: {}, output: {}, reasoning: text });
    },

    // Seal the session and sign the final root.
    seal() {
      const sealed = session.seal();
      checkpoint("seal");
      return sealed;
    },

    // The session export plus the gateway's signatures.
    exportSession() {
      return {
        ...session.export(),
        provenance: {
          gateway: { keyId: signer.keyId, publicKey: signer.publicKey },
          recordSignatures: [...recordSignatures],
          checkpoints: [...checkpoints],
        },
      };
    },

    closeAll: () => host.closeAll(),
  };
}
