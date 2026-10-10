import fs from "node:fs";
import { hashActionRecord, computeMerkleRoot, generateMerkleProof, verifyMerkleProof } from "@vluthra/agent-ledger";
import { ephemeralSigner, messages } from "./keys.js";
import { anchorBackend, trustedAnchorers, readAnchor } from "./anchor.js";
import { SESSION_PATH as SESSION, BACKUP_PATH as BACKUP } from "./finalize.js";

export function getSession() {
  try { return JSON.parse(fs.readFileSync(SESSION, "utf8")); } catch { return null; }
}

// Tamper modes, each a stronger attacker than the last:
//   naive  change a field, leave the stored hash alone
//   smart  also re-hash, re-chain, and re-seal locally
//   forge  rewrite everything the file holds: re-seal, overwrite the cached
//          anchor root, re-sign every receipt and checkpoint with the attacker's
//          own key (swapping in its public key), and strip the server receipt
//          from the edited record since the attacker can't re-sign it.
//          The result is a fully self-consistent file.
export function tamperSession({ seq, path, value, smart, mode }) {
  mode = mode || (smart ? "smart" : "naive");
  if (!["naive", "smart", "forge"].includes(mode)) throw new Error("unknown tamper mode " + mode);
  if (!fs.existsSync(BACKUP)) fs.copyFileSync(SESSION, BACKUP);
  const data = getSession();
  const idx = data.records.findIndex((r) => r.sequenceNumber === Number(seq));
  if (idx < 0) throw new Error("no record with sequenceNumber " + seq);
  const parts = String(path).split(".");
  let o = data.records[idx];
  for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
  const key = parts[parts.length - 1];
  const before = o[key];
  let v = value;
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) v = Number(v);
  o[key] = v;

  if (mode === "forge" && data.records[idx].metadata?.serverReceipt) delete data.records[idx].metadata.serverReceipt;
  if (mode !== "naive") {
    for (let i = idx; i < data.records.length; i++) {
      data.records[i].previousHash = i > 0 ? data.records[i - 1].hash : null;
      data.records[i].hash = hashActionRecord(data.records[i]);
    }
    data.session.merkleRoot = computeMerkleRoot(data.records.map((r) => r.hash));
  }
  if (mode === "forge") {
    const hashes = data.records.map((r) => r.hash);
    const sid = data.session.sessionId;
    if (data.anchor) data.anchor.root = "0x" + data.session.merkleRoot;
    if (data.provenance) {
      const attacker = ephemeralSigner();
      data.provenance.gateway = { keyId: attacker.keyId, publicKey: attacker.publicKey };
      data.provenance.recordSignatures = data.records.map((r) => attacker.sign(messages.record(sid, r.sequenceNumber, r.hash)));
      data.provenance.checkpoints = data.provenance.checkpoints.map((cp) => {
        const root = computeMerkleRoot(hashes.slice(0, cp.recordCount));
        return { ...cp, root, signature: attacker.sign(messages.checkpoint(cp.kind, sid, cp.recordCount, root)) };
      });
    }
  }
  fs.writeFileSync(SESSION, JSON.stringify(data, null, 2));
  return { seq, path, before, after: v, mode, smart: mode !== "naive" };
}
export function restoreSession() {
  if (!fs.existsSync(BACKUP)) throw new Error("no backup to restore from");
  fs.copyFileSync(BACKUP, SESSION);
  return true;
}
// Proves one record belongs to the session root, then ties that root to the
// anchor read from its source (chain or rehearsal registry). Only with no anchor
// source configured does it fall back to the copy cached in the session file,
// and says so.
export async function proveRecord(seq) {
  const data = getSession();
  const leaves = data.records.map((r) => r.hash);
  const idx = data.records.findIndex((r) => r.sequenceNumber === Number(seq));
  if (idx < 0) throw new Error("no record with sequenceNumber " + seq);
  const proof = generateMerkleProof(leaves, idx);
  const ok = verifyMerkleProof(proof);

  let anchoredRoot = null, anchorSource;
  const backend = anchorBackend();
  if (backend) {
    anchorSource = backend === "rehearsal" ? "rehearsal registry" : "chain";
    try {
      for (const a of backend === "rehearsal" ? ["rehearsal"] : trustedAnchorers()) {
        const on = await readAnchor(a, data.session.sessionId);
        if (on) { anchoredRoot = on.root; break; }
      }
      if (!anchoredRoot) anchorSource += " (no anchor found for this session)";
    } catch (e) {
      anchorSource += " (unreachable: " + (e.shortMessage || e.message) + ")";
    }
  } else {
    anchoredRoot = (data.anchor?.root || data.session.merkleRoot || "").replace(/^0x/, "");
    anchorSource = "session file (NOT independent)";
  }
  const rec = data.records[idx];
  return {
    seq, label: rec.metadata?.tool || rec.actionType, records: leaves.length, siblings: proof.siblings.length,
    valid: ok, tiesToAnchor: !!anchoredRoot && proof.root === anchoredRoot, anchorSource,
  };
}
