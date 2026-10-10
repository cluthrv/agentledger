// ---------------------------------------------------------------------------
// PROVE ONE ACTION (Phase 6)
//   node host/prove.js <sequenceNumber>
// Proves one record belongs to the anchored root using ~log2(n) sibling hashes,
// without needing or revealing the other records. The root it ties to is read
// from the anchor's source (the chain), not from the session file.
// ---------------------------------------------------------------------------
import "dotenv/config";
import { proveRecord } from "./ops.js";

let p;
try { p = await proveRecord(Number(process.argv[2])); }
catch (e) { console.error(e.message); process.exit(1); }

console.log(`
Proving record ${p.seq} (${p.label}) belongs to the anchored session.
`);
console.log(`  records in session:     ${p.records}`);
console.log(`  sibling hashes needed:  ${p.siblings}  (about log2 of the record count)`);
console.log(`  proof valid:            ${p.valid}`);
console.log(`  ties to anchored root:  ${p.tiesToAnchor}  [anchor read from: ${p.anchorSource}]`);
if (p.valid && p.tiesToAnchor) console.log(`
  Proved one action without needing or revealing the other ${p.records - 1} records.`);
process.exit(p.valid && p.tiesToAnchor ? 0 : 1);
