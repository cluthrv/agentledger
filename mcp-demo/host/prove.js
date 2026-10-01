// ---------------------------------------------------------------------------
// PROVE ONE ACTION (Phase 6)
//   node host/prove.js <sequenceNumber>
// Proves one record belongs to the anchored root using ~log2(n) sibling hashes,
// without needing or revealing the other records.
// ---------------------------------------------------------------------------
import fs from "node:fs";
import { generateMerkleProof, verifyMerkleProof } from "@vluthra/agent-ledger";

const seq = Number(process.argv[2]);
const data = JSON.parse(fs.readFileSync("data/sessions/session.json", "utf8"));
const leaves = data.records.map((r) => r.hash);
const idx = data.records.findIndex((r) => r.sequenceNumber === seq);
if (idx < 0) { console.error("No record with sequenceNumber " + seq); process.exit(1); }

const proof = generateMerkleProof(leaves, idx);
const ok = verifyMerkleProof(proof);
const anchoredRoot = (data.anchor?.root || "").replace(/^0x/, "");
const tiesToAnchor = anchoredRoot ? proof.root === anchoredRoot : proof.root === data.session.merkleRoot;

const rec = data.records[idx];
console.log(`\nProving record ${seq} (${rec.metadata?.tool || rec.actionType}) belongs to the anchored session.\n`);
console.log(`  records in session:     ${leaves.length}`);
console.log(`  sibling hashes needed:  ${proof.siblings.length}  (about log2 of the record count)`);
console.log(`  proof valid:            ${ok}`);
console.log(`  ties to anchored root:  ${tiesToAnchor}`);
console.log(`\n  Proved one action without needing or revealing the other ${leaves.length - 1} records.`);
