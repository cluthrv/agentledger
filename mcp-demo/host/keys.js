// ---------------------------------------------------------------------------
// SIGNING KEYS
// Ed25519 keys for the parties that sign: the gateway (signs every receipt and
// checkpoint) and any MCP server that signs its own results (the bureau).
// A key is loaded from <NAME>_SIGNING_KEY in the environment (PEM), or from
// data/keys/<name>.key.pem, which is generated on first use.
//
// The verifier never trusts a public key found inside a session file. It pins
// keys from <NAME>_PUBLIC_KEY in the environment or data/keys/<name>.pub.pem.
// In production those pins belong somewhere the operator can't rewrite (a
// config repo, a KMS, the auditor's own machine); for the demo they sit on disk.
// ---------------------------------------------------------------------------
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const KEY_DIR = path.join("data", "keys");
const envName = (name) => name.toUpperCase().replace(/[^A-Z0-9]/g, "_");

export function loadSigningKey(name) {
  const fromEnv = process.env[envName(name) + "_SIGNING_KEY"];
  if (fromEnv) return makeSigner(crypto.createPrivateKey(fromEnv.replace(/\\n/g, "\n")));
  const keyPath = path.join(KEY_DIR, name + ".key.pem");
  if (!fs.existsSync(keyPath)) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
    fs.mkdirSync(KEY_DIR, { recursive: true });
    fs.writeFileSync(keyPath, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    fs.writeFileSync(path.join(KEY_DIR, name + ".pub.pem"), publicKey.export({ type: "spki", format: "pem" }));
  }
  return makeSigner(crypto.createPrivateKey(fs.readFileSync(keyPath, "utf8")));
}

// A fresh, throwaway key: what an attacker without the real key would sign with.
export function ephemeralSigner() {
  return makeSigner(crypto.generateKeyPairSync("ed25519").privateKey);
}

function makeSigner(privateKey) {
  const publicKey = crypto.createPublicKey(privateKey).export({ type: "spki", format: "pem" });
  return {
    publicKey,
    keyId: keyId(publicKey),
    sign: (message) => crypto.sign(null, Buffer.from(message), privateKey).toString("base64"),
  };
}

// The pinned public key for a party, or null if none is configured.
export function trustedPublicKey(name) {
  const fromEnv = process.env[envName(name) + "_PUBLIC_KEY"];
  if (fromEnv) return fromEnv.replace(/\\n/g, "\n");
  const pubPath = path.join(KEY_DIR, name + ".pub.pem");
  return fs.existsSync(pubPath) ? fs.readFileSync(pubPath, "utf8") : null;
}

export function keyId(publicKeyPem) {
  const der = crypto.createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  return crypto.createHash("sha256").update(der).digest("hex").slice(0, 16);
}

export function verifySignature(publicKeyPem, message, signatureB64) {
  try {
    return crypto.verify(null, Buffer.from(message), publicKeyPem, Buffer.from(signatureB64, "base64"));
  } catch {
    return false;
  }
}

// Deterministic JSON (sorted keys) so both sides hash identical bytes.
export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  return "{" + Object.keys(value).sort().filter((k) => value[k] !== undefined)
    .map((k) => JSON.stringify(k) + ":" + canonicalJson(value[k])).join(",") + "}";
}

export const sha256Hex = (s) => crypto.createHash("sha256").update(s).digest("hex");

// Domain-separated messages, so a signature over one kind of thing can never be
// replayed as a signature over another.
export const messages = {
  record: (sessionId, seq, hash) => `agentledger/record/v1\n${sessionId}\n${seq}\n${hash}`,
  checkpoint: (kind, sessionId, recordCount, root) => `agentledger/${kind}/v1\n${sessionId}\n${recordCount}\n${root}`,
  serverReceipt: (r) => `agentledger/server-receipt/v1\n${r.server}\n${r.tool}\n${r.argsHash}\n${r.resultHash}\n${r.issuedAt}`,
};

// _meta keys on the MCP tools/call result.
export const RECEIPT_META_KEY = "io.agentledger/receipt";
export const SERVER_RECEIPT_META_KEY = "io.agentledger/server-receipt";
