// Checks vectors.json against the receipts extension spec (revision 0), using
// only node:crypto. It does not import AgentLedger: canonical JSON, the record
// hash and the verification steps are written here from the spec, so a pass
// shows the spec is enough to interoperate.
//
//   node docs/extensions/receipts/check-vectors.mjs
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const v = JSON.parse(fs.readFileSync(path.join(here, "vectors.json"), "utf8"));

// RFC 8785 for the values that occur here: sorted keys, JSON.stringify scalars.
function jcs(x) {
  if (x === null || typeof x !== "object") {
    if (typeof x === "number" && !Number.isFinite(x)) throw new Error("non-finite number");
    return JSON.stringify(x);
  }
  if (Array.isArray(x)) return "[" + x.map(jcs).join(",") + "]";
  return "{" + Object.keys(x).filter((k) => x[k] !== undefined).sort()
    .map((k) => JSON.stringify(k) + ":" + jcs(x[k])).join(",") + "}";
}
const sha256 = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
const pub = (rawHex) => crypto.createPublicKey({
  key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(rawHex, "hex")]),
  format: "der", type: "spki",
});
const keyId = (rawHex) => sha256Bytes(pub(rawHex).export({ type: "spki", format: "der" })).slice(0, 16);
function sha256Bytes(b) { return crypto.createHash("sha256").update(b).digest("hex"); }
const verifySig = (rawHex, msg, sigB64) => {
  try { return crypto.verify(null, Buffer.from(msg, "utf8"), pub(rawHex), Buffer.from(sigB64, "base64")); }
  catch { return false; }
};

// Spec section 5: verifying a server receipt against the pinned server key.
function verifyServerReceipt(pinnedKey, expected, args, structuredContent, rc) {
  if (!rc) return "missing";
  for (const f of ["server", "tool", "argsHash", "resultHash", "issuedAt", "keyId", "signature"])
    if (typeof rc[f] !== "string") return "malformed";
  if (rc.server !== expected.server || rc.tool !== expected.tool) return "wrong-target";
  const msg = `agentledger/server-receipt/v1\n${rc.server}\n${rc.tool}\n${rc.argsHash}\n${rc.resultHash}\n${rc.issuedAt}`;
  if (!verifySig(pinnedKey, msg, rc.signature)) return "bad-signature";
  if (rc.argsHash !== sha256(jcs(args))) return "args-mismatch";
  if (rc.resultHash !== sha256(jcs(structuredContent))) return "result-mismatch";
  return "valid";
}

// Spec section 6: the v2 record hash, then the gateway signature.
function recordHashV2(r) {
  const c = {
    id: r.id, sessionId: r.sessionId, sequenceNumber: r.sequenceNumber, timestamp: r.timestamp,
    actionType: r.actionType, input: r.input ?? {}, output: r.output ?? {}, previousHash: r.previousHash ?? null,
  };
  for (const k of ["agentId", "reasoning", "metadata"]) if (r[k] != null) c[k] = r[k];
  return sha256("agentledger/record-hash/v2\n" + jcs(c));
}
function verifyGatewayReceipt(pinnedKey, record, rc) {
  if (!rc) return "missing";
  const msg = `agentledger/record-sig/v2\n${rc.sessionId}\n${rc.seq}\n${rc.hash}`;
  if (!verifySig(pinnedKey, msg, rc.signature)) return "bad-signature";
  if (rc.sessionId !== record.sessionId || rc.seq !== record.sequenceNumber || rc.previousHash !== record.previousHash) return "wrong-record";
  if (rc.hash !== recordHashV2(record)) return "hash-mismatch";
  return "valid";
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
  if (!ok) failures++;
};

const S = v.keys.server.publicKey;
const G = v.keys.gateway.publicKey;
const target = { server: "bureau", tool: "get_credit_score" };

check("key ids are SHA-256(SPKI DER)[0:16]", keyId(S) === v.keys.server.keyId && keyId(G) === v.keys.gateway.keyId);
const sr = v.serverReceipt;
check("server: canonical arguments", jcs(sr.args) === sr.argsCanonical);
check("server: canonical result", jcs(sr.structuredContent) === sr.resultCanonical);
check("server: signed message bytes", `agentledger/server-receipt/v1\n${sr.receipt.server}\n${sr.receipt.tool}\n${sr.receipt.argsHash}\n${sr.receipt.resultHash}\n${sr.receipt.issuedAt}` === sr.signedMessage);
check("server: receipt in the tool result's _meta", jcs(sr.toolResult._meta["io.github.cluthrv/server-receipt"]) === jcs(sr.receipt));
check("server: valid receipt verifies", verifyServerReceipt(S, target, sr.args, sr.toolResult.structuredContent, sr.receipt) === "valid");

const gr = v.gatewayReceipt;
check("gateway: record hash v2", recordHashV2(gr.record) === gr.record.hash);
check("gateway: signed message bytes", `agentledger/record-sig/v2\n${gr.receipt.sessionId}\n${gr.receipt.seq}\n${gr.receipt.hash}` === gr.signedMessage);
check("gateway: valid receipt verifies", verifyGatewayReceipt(G, gr.record, gr.receipt) === "valid");
check("gateway: the record carries the server receipt", jcs(gr.record.metadata.serverReceipt) === jcs(sr.receipt));

for (const n of v.negative) {
  const got = n.name.startsWith("server")
    ? verifyServerReceipt(S, target, n.args, n.structuredContent, n.receipt)
    : verifyGatewayReceipt(G, n.record, n.receipt);
  check(`rejects ${n.name}`, got === n.expect, `got ${got}, expected ${n.expect}`);
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll vectors check out.");
process.exit(failures ? 1 : 0);
