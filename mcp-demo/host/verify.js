// ---------------------------------------------------------------------------
// VERIFY (Phase 6)
// Recomputes everything from the saved session and checks it against the
// ANCHORED root. Works offline using the cached anchor reference. Catches both
// a naive edit (content changed, hash left alone) and a sophisticated edit
// (attacker re-hashes and re-seals locally, but the anchored root still won't match).
// ---------------------------------------------------------------------------
import "dotenv/config";
import fs from "node:fs";
import { hashActionRecord, computeMerkleRoot } from "@vluthra/agent-ledger";

export function verifySession(sessionPath = "data/sessions/session.json") {
  const data = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
  const { records, session, anchor } = data;
  const checks = [];

  // 1. Each record's content must still match its stored hash.
  let contentOk = true, firstBad = -1;
  for (let i = 0; i < records.length; i++) {
    if (hashActionRecord(records[i]) !== records[i].hash) { contentOk = false; if (firstBad < 0) firstBad = i; }
  }
  checks.push({
    name: "record_hash_integrity",
    passed: contentOk,
    detail: contentOk
      ? `all ${records.length} record hashes match their content`
      : `record ${firstBad} (${records[firstBad].metadata?.tool || records[firstBad].actionType}) content does NOT match its stored hash`,
  });

  // 2. Chain linkage: each previousHash equals the prior record's hash.
  let chainOk = true, badLink = -1;
  for (let i = 1; i < records.length; i++) {
    if (records[i].previousHash !== records[i - 1].hash) { chainOk = false; badLink = i; break; }
  }
  checks.push({
    name: "hash_chain_linkage",
    passed: chainOk,
    detail: chainOk ? "chain intact" : `chain broken at record ${badLink}`,
  });

  // 3. Recompute the Merkle root and compare to the ANCHORED root.
  const recomputed = computeMerkleRoot(records.map((r) => r.hash));
  const anchoredRoot = (anchor?.root || "").replace(/^0x/, "");
  const target = anchoredRoot || session.merkleRoot;
  const rootOk = recomputed === target;
  checks.push({
    name: anchoredRoot ? "anchored_root_match" : "sealed_root_match",
    passed: rootOk,
    detail: rootOk
      ? `recomputed root matches the ${anchoredRoot ? "anchored" : "sealed"} root`
      : `recomputed root ${recomputed.slice(0, 12)}... does NOT match the ${anchoredRoot ? "anchored" : "sealed"} root ${target.slice(0, 12)}...`,
  });

  return { valid: checks.every((c) => c.passed), checks, anchor, recomputed };
}

// CLI
if (process.argv[1] && process.argv[1].endsWith("verify.js")) {
  const r = verifySession();
  console.log("\nVerifying session against the anchored root...\n");
  for (const c of r.checks) console.log(`  [${c.passed ? "ok " : "XX "}] ${c.name}: ${c.detail}`);
  if (r.anchor) console.log(`\n  anchored on ${r.anchor.chain}, root ${r.anchor.root.slice(0, 14)}...`);
  console.log("\n  RESULT: " + (r.valid ? "VERIFIED - the record is intact and matches what was anchored." : "TAMPER DETECTED - the record no longer matches what was anchored."));
  process.exit(r.valid ? 0 : 1);
}
