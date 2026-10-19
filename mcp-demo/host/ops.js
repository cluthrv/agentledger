import fs from "node:fs";
import { ephemeralSigner, messages } from "./keys.js";
import { anchorBackend, trustedAnchorers, readAnchor } from "./anchor.js";
import { sessionVersion, recordHash, merkleRoot, merkleProof, verifyProof } from "./hashing.js";
import { SESSION_PATH as SESSION, BACKUP_PATH as BACKUP } from "./finalize.js";

export function getSession() {
  try { return JSON.parse(fs.readFileSync(SESSION, "utf8")); } catch { return null; }
}

// Tamper modes, each a stronger attacker than the last:
//   naive       change a field, leave the stored hash alone
//   nested-arg  a preset naive edit of a nested tool argument: create_credit_line's
//               args.amount -> 240000. v1 hashing missed this; v2 catches it.
//   smart       also re-hash, re-chain, and re-seal locally
//   forge       rewrite everything the file holds: re-seal, overwrite the cached
//               anchor root, re-sign every receipt and checkpoint with the attacker's
//               own key (swapping in its public key), and strip the server receipt
//               from the edited record since the attacker can't re-sign it.
//               The result is a fully self-consistent file.
// Hashes are recomputed with the file's own version (v1 or v2).
export function tamperSession({ seq, path, value, smart, mode }) {
  mode = mode || (smart ? "smart" : "naive");
  if (!["naive", "nested-arg", "smart", "forge"].includes(mode)) throw new Error("unknown tamper mode " + mode);
  if (!fs.existsSync(BACKUP)) fs.copyFileSync(SESSION, BACKUP);
  const data = getSession();
  if (mode === "nested-arg") {
    const target = data.records.find((r) => r.metadata?.tool === "create_credit_line");
    if (!target) throw new Error("no create_credit_line record in this session");
    seq = target.sequenceNumber; path = "input.args.amount"; value = 240000;
  }
  const { canonicalization: version } = sessionVersion(data);
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
  if (mode === "smart" || mode === "forge") {
    for (let i = idx; i < data.records.length; i++) {
      data.records[i].previousHash = i > 0 ? data.records[i - 1].hash : null;
      data.records[i].hash = recordHash(version, data.records[i]);
    }
    data.session.merkleRoot = merkleRoot(version, data.records.map((r) => r.hash));
  }
  if (mode === "forge") {
    const hashes = data.records.map((r) => r.hash);
    const sid = data.session.sessionId;
    if (data.anchor) data.anchor.root = "0x" + data.session.merkleRoot;
    if (data.provenance) {
      const attacker = ephemeralSigner();
      data.provenance.gateway = { keyId: attacker.keyId, publicKey: attacker.publicKey };
      data.provenance.recordSignatures = data.records.map((r) => attacker.sign(messages.record(version, sid, r.sequenceNumber, r.hash)));
      data.provenance.checkpoints = data.provenance.checkpoints.map((cp) => {
        const root = merkleRoot(version, hashes.slice(0, cp.recordCount));
        return { ...cp, root, signature: attacker.sign(messages.checkpoint(version, cp.kind, sid, cp.recordCount, root)) };
      });
    }
  }
  fs.writeFileSync(SESSION, JSON.stringify(data, null, 2));
  return { seq: Number(seq), path, before, after: v, mode, smart: mode === "smart" || mode === "forge" };
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
  const { canonicalization: version } = sessionVersion(data);
  const idx = data.records.findIndex((r) => r.sequenceNumber === Number(seq));
  if (idx < 0) throw new Error("no record with sequenceNumber " + seq);
  // The leaf is the record's hash recomputed from its content as it stands now,
  // so an edited record can't be proved; siblings come from the stored hashes.
  const leaves = data.records.map((r, i) => (i === idx ? recordHash(version, r) : r.hash));
  const proof = merkleProof(version, leaves, idx);
  const ok = verifyProof(version, proof);

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
    version, valid: ok, tiesToAnchor: !!anchoredRoot && proof.root === anchoredRoot, anchorSource,
  };
}
