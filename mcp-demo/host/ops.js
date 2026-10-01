import fs from "node:fs";
import { hashActionRecord, computeMerkleRoot, generateMerkleProof, verifyMerkleProof } from "@vluthra/agent-ledger";

const SESSION = "data/sessions/session.json";
const BACKUP = "data/sessions/session.backup.json";

export function getSession() {
  try { return JSON.parse(fs.readFileSync(SESSION, "utf8")); } catch { return null; }
}
export function tamperSession({ seq, path, value, smart }) {
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
  if (smart) {
    for (let i = idx; i < data.records.length; i++) {
      data.records[i].previousHash = i > 0 ? data.records[i - 1].hash : null;
      data.records[i].hash = hashActionRecord(data.records[i]);
    }
    data.session.merkleRoot = computeMerkleRoot(data.records.map((r) => r.hash));
  }
  fs.writeFileSync(SESSION, JSON.stringify(data, null, 2));
  return { seq, path, before, after: v, smart: !!smart };
}
export function restoreSession() {
  if (!fs.existsSync(BACKUP)) throw new Error("no backup to restore from");
  fs.copyFileSync(BACKUP, SESSION);
  return true;
}
export function proveRecord(seq) {
  const data = getSession();
  const leaves = data.records.map((r) => r.hash);
  const idx = data.records.findIndex((r) => r.sequenceNumber === Number(seq));
  if (idx < 0) throw new Error("no record with sequenceNumber " + seq);
  const proof = generateMerkleProof(leaves, idx);
  const ok = verifyMerkleProof(proof);
  const anchoredRoot = (data.anchor?.root || "").replace(/^0x/, "");
  const ties = anchoredRoot ? proof.root === anchoredRoot : proof.root === data.session.merkleRoot;
  const rec = data.records[idx];
  return { seq, label: rec.metadata?.tool || rec.actionType, records: leaves.length, siblings: proof.siblings.length, valid: ok, tiesToAnchor: ties };
}
