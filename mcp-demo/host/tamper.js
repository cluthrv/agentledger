// ---------------------------------------------------------------------------
// TAMPER (Phase 6, demo attacker tool)
//   node host/tamper.js <sequenceNumber> <path> <value> [--smart]
// naive (default): change content, leave the stored hash -> breaks record_hash_integrity
// --smart: also recompute this record's hash, re-chain, and re-seal locally
//          -> chain looks intact, but the ANCHORED root still won't match
// A backup is written once so you can restore and re-run the demo.
// ---------------------------------------------------------------------------
import fs from "node:fs";
import { hashActionRecord, computeMerkleRoot } from "@vluthra/agent-ledger";

const SESSION = "data/sessions/session.json";
const BACKUP = "data/sessions/session.backup.json";

const args = process.argv.slice(2);
const smart = args.includes("--smart");
const [seqStr, path, ...valueParts] = args.filter((a) => a !== "--smart");
const seq = Number(seqStr);
let value = valueParts.join(" ");
if (/^-?\d+(\.\d+)?$/.test(value)) value = Number(value);

if (!fs.existsSync(BACKUP)) fs.copyFileSync(SESSION, BACKUP); // one-time backup

const data = JSON.parse(fs.readFileSync(SESSION, "utf8"));
const idx = data.records.findIndex((r) => r.sequenceNumber === seq);
if (idx < 0) { console.error("No record with sequenceNumber " + seq); process.exit(1); }

// set a dot path (e.g. output.score, reasoning) on the target record
function setPath(obj, dotted, v) {
  const parts = dotted.split(".");
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
  const before = o[parts[parts.length - 1]];
  o[parts[parts.length - 1]] = v;
  return before;
}
const before = setPath(data.records[idx], path, value);
console.log(`Tampered record ${seq} (${data.records[idx].metadata?.tool || data.records[idx].actionType}): ${path}`);
console.log(`   ${JSON.stringify(before)}  ->  ${JSON.stringify(value)}`);

if (smart) {
  // attacker recomputes hashes from the edited record forward, re-chains, re-seals locally
  for (let i = idx; i < data.records.length; i++) {
    data.records[i].previousHash = i > 0 ? data.records[i - 1].hash : null;
    data.records[i].hash = hashActionRecord(data.records[i]);
  }
  data.session.merkleRoot = computeMerkleRoot(data.records.map((r) => r.hash));
  console.log("   --smart: re-hashed, re-chained, and re-sealed locally (new local root " + data.session.merkleRoot.slice(0, 12) + "...)");
  console.log("   but the anchored root on chain is unchanged.");
}

fs.writeFileSync(SESSION, JSON.stringify(data, null, 2));
console.log("Saved. Now run:  npm run verify");
