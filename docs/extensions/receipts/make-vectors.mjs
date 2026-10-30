// Generates vectors.json for the receipts extension (revision 0).
//
//   npm run build            (at the repo root, once)
//   node docs/extensions/receipts/make-vectors.mjs
//
// Keys are the RFC 8032 section 7.1 test keys, so every hash and signature is
// reproducible: Ed25519 signatures are deterministic.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const { canonicalJson, hashActionRecordV2 } = createRequire(import.meta.url)("../../../dist/index.js");

const PKCS8_ED25519 = "302e020100300506032b657004220420";
function key(seedHex) {
  const privateKey = crypto.createPrivateKey({ key: Buffer.from(PKCS8_ED25519 + seedHex, "hex"), format: "der", type: "pkcs8" });
  const publicKey = crypto.createPublicKey(privateKey);
  const spki = publicKey.export({ type: "spki", format: "der" });
  return {
    privateKey,
    seed: seedHex,
    publicKeyRaw: spki.subarray(12).toString("hex"),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }),
    keyId: crypto.createHash("sha256").update(spki).digest("hex").slice(0, 16),
  };
}
const sha256 = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
const sign = (k, msg) => crypto.sign(null, Buffer.from(msg, "utf8"), k.privateKey).toString("base64");

// RFC 8032 7.1 TEST 1 (server) and TEST 2 (gateway); TEST 3 plays an attacker.
const server = key("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60");
const gateway = key("4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb");
const attacker = key("c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7");

const serverMessage = (r) =>
  `agentledger/server-receipt/v1\n${r.server}\n${r.tool}\n${r.argsHash}\n${r.resultHash}\n${r.issuedAt}`;
const recordMessage = (sessionId, seq, hash) => `agentledger/record-sig/v2\n${sessionId}\n${seq}\n${hash}`;

// --- server receipt ---------------------------------------------------------
const args = { customerId: "MER-100" };
const structuredContent = { score: 580, previousQuarter: 690 };
const serverReceipt = {
  server: "bureau",
  tool: "get_credit_score",
  argsHash: sha256(canonicalJson(args)),
  resultHash: sha256(canonicalJson(structuredContent)),
  issuedAt: "2026-10-23T16:05:12.345Z",
  keyId: server.keyId,
};
const serverMsg = serverMessage(serverReceipt);
serverReceipt.signature = sign(server, serverMsg);

const toolResult = {
  content: [{ type: "text", text: JSON.stringify(structuredContent) }],
  structuredContent,
  _meta: { "io.github.cluthrv/server-receipt": serverReceipt },
};

// --- gateway receipt -----------------------------------------------------------
const sessionId = "13a97669-8f6a-4c36-9391-ac982140e2c3";
const record = {
  id: "8c0d4c8a-1f2e-4b7a-9f00-000000000002",
  sessionId,
  sequenceNumber: 1,
  timestamp: "2026-10-23T16:05:12.401Z",
  agentId: "sales-ops-agent",
  actionType: "tool_call",
  input: { tool: "get_credit_score", args },
  output: structuredContent,
  metadata: { tool: "get_credit_score", system: "bureau", trustDomain: "external:credit-bureau", serverReceipt },
  previousHash: "5d2f1f0c3bfa3a2b6d1e0e7f9b0c4a8d2e6f1a3b5c7d9e0f1a2b3c4d5e6f7a8b",
};
record.hash = hashActionRecordV2(record);
const gatewayMsg = recordMessage(sessionId, record.sequenceNumber, record.hash);
const gatewayReceipt = {
  sessionId,
  seq: record.sequenceNumber,
  hash: record.hash,
  previousHash: record.previousHash,
  keyId: gateway.keyId,
  signature: sign(gateway, gatewayMsg),
};

// --- negative cases ----------------------------------------------------------------
const clone = (o) => JSON.parse(JSON.stringify(o));
const negative = [];
{
  const t = clone({ args, structuredContent, receipt: serverReceipt });
  t.args.customerId = "MER-200";
  negative.push({ name: "server: arguments changed after signing", expect: "args-mismatch", ...t });
}
{
  const t = clone({ args, structuredContent, receipt: serverReceipt });
  t.structuredContent.score = 720;
  negative.push({ name: "server: result changed after signing", expect: "result-mismatch", ...t });
}
{
  const t = clone({ args, structuredContent, receipt: serverReceipt });
  t.receipt.resultHash = sha256(canonicalJson({ score: 720, previousQuarter: 690 }));
  t.structuredContent.score = 720;
  negative.push({ name: "server: result and resultHash both changed, signature kept", expect: "bad-signature", ...t });
}
{
  const t = clone({ args, structuredContent, receipt: serverReceipt });
  t.structuredContent.score = 720;
  t.receipt.resultHash = sha256(canonicalJson(t.structuredContent));
  t.receipt.keyId = attacker.keyId;
  t.receipt.signature = sign(attacker, serverMessage(t.receipt));
  negative.push({ name: "server: re-signed with a key that is not pinned", expect: "bad-signature", ...t });
}
{
  const t = clone({ args, structuredContent, receipt: serverReceipt });
  t.receipt.issuedAt = "2026-10-24T09:00:00.000Z";
  negative.push({ name: "server: issuedAt changed", expect: "bad-signature", ...t });
}
{
  const t = clone({ args, structuredContent });
  negative.push({ name: "server: advertised the extension but sent no receipt", expect: "missing", ...t, receipt: null });
}
{
  const t = clone({ record, receipt: gatewayReceipt });
  t.record.input.args.customerId = "MER-200";
  negative.push({ name: "gateway: recorded nested argument changed", expect: "hash-mismatch", ...t });
}
{
  const t = clone({ record, receipt: gatewayReceipt });
  t.receipt.seq = 2;
  negative.push({ name: "gateway: receipt moved to another position", expect: "bad-signature", ...t });
}

const vectors = {
  extension: "io.github.cluthrv/receipts",
  revision: "0",
  note: "Generated by make-vectors.mjs. Keys are the RFC 8032 section 7.1 test keys; never use them for anything real.",
  keys: {
    server: { seed: server.seed, publicKey: server.publicKeyRaw, publicKeyPem: server.publicKeyPem, keyId: server.keyId },
    gateway: { seed: gateway.seed, publicKey: gateway.publicKeyRaw, publicKeyPem: gateway.publicKeyPem, keyId: gateway.keyId },
    unpinned: { seed: attacker.seed, publicKey: attacker.publicKeyRaw, keyId: attacker.keyId },
  },
  serverReceipt: {
    args,
    argsCanonical: canonicalJson(args),
    structuredContent,
    resultCanonical: canonicalJson(structuredContent),
    signedMessage: serverMsg,
    receipt: serverReceipt,
    toolResult,
  },
  gatewayReceipt: {
    record,
    signedMessage: gatewayMsg,
    receipt: gatewayReceipt,
  },
  negative,
};

const out = path.join(here, "vectors.json");
fs.writeFileSync(out, JSON.stringify(vectors, null, 2) + "\n");
console.log("wrote", out);
