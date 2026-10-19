// End-to-end tests for the MCP demo, in rehearsal mode (scripted model, no API
// calls, rehearsal registry instead of a chain). Each run works in a fresh temp
// copy of the demo, so a real session, real keys and .env are never touched.
//   npm test
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { computeMerkleRootV2 } from "@vluthra/agent-ledger";

const demo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let ws;
const env = {
  ...process.env,
  DEMO_MOCK: "1",
  ARBITRUM_SEPOLIA_RPC_URL: "", ANCHOR_CONTRACT_ADDRESS: "", ANCHOR_PRIVATE_KEY: "", ANCHOR_TRUSTED_ADDRESSES: "",
  GATEWAY_SIGNING_KEY: "", GATEWAY_PUBLIC_KEY: "", BUREAU_SIGNING_KEY: "", BUREAU_PUBLIC_KEY: "",
};

const run = (...args) => spawnSync(process.execPath, args, { cwd: ws, env, encoding: "utf8", timeout: 120000 });
const verify = () => run("host/verify.js");
const sessionFile = () => path.join(ws, "data", "sessions", "session.json");
const readSession = () => JSON.parse(fs.readFileSync(sessionFile(), "utf8"));
const restore = () => assert.equal(run("host/restore.js").status, 0);

before(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), "agentledger-demo-"));
  for (const dir of ["host", "servers", "contracts", "test"]) fs.cpSync(path.join(demo, dir), path.join(ws, dir), { recursive: true });
  fs.copyFileSync(path.join(demo, "package.json"), path.join(ws, "package.json"));
  fs.symlinkSync(path.join(demo, "node_modules"), path.join(ws, "node_modules"), "junction");
  const r = run("host/run-record.js");
  assert.equal(r.status, 0, r.stderr || r.stdout);
});

after(() => { if (ws) fs.rmSync(ws, { recursive: true, force: true }); });

test("a new session is hashed with v2 and says so", () => {
  const d = readSession();
  assert.equal(d.canonicalization, "v2");
  assert.equal(d.merkle, "v2");
  assert.equal(d.session.merkleRoot, computeMerkleRootV2(d.records.map((r) => r.hash)));
  assert.equal(d.provenance.recordSignatures.length, d.records.length);
});

test("receipts use the io.github.cluthrv _meta keys", () => {
  const keys = fs.readFileSync(path.join(ws, "host", "keys.js"), "utf8");
  assert.match(keys, /"io\.github\.cluthrv\/receipt"/);
  assert.match(keys, /"io\.github\.cluthrv\/server-receipt"/);
  assert.ok(readSession().records.some((r) => r.metadata?.serverReceipt?.signature), "bureau receipt recorded");
});

test("a clean session verifies", () => {
  const r = verify();
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /RESULT: VERIFIED/);
});

test("nested-arg tamper is detected and names the record", () => {
  const t = run("host/tamper.js", "--nested-arg");
  assert.equal(t.status, 0, t.stderr);
  assert.match(t.stdout, /input\.args\.amount/);
  assert.match(t.stdout, /2400000\s+->\s+240000/);
  const r = verify();
  assert.equal(r.status, 1);
  assert.match(r.stdout, /RESULT: TAMPER DETECTED/);
  assert.match(r.stdout, /record_hash_integrity: record \d+ \(create_credit_line\)/);
  restore();
});

for (const [mode, flag] of [["naive", []], ["smart", ["--smart"]], ["forge", ["--forge"]]]) {
  test(`${mode} tamper is detected`, () => {
    const seq = readSession().records.find((x) => x.metadata?.tool === "get_credit_score").sequenceNumber;
    assert.equal(run("host/tamper.js", String(seq), "output.score", "720", ...flag).status, 0);
    const r = verify();
    assert.equal(r.status, 1);
    assert.match(r.stdout, /RESULT: TAMPER DETECTED/);
    restore();
  });
}

test("restore brings the session back to VERIFIED", () => {
  assert.match(verify().stdout, /RESULT: VERIFIED/);
});

test("prove ties a clean record to the anchor, and not an edited one", () => {
  const seq = String(readSession().records.find((x) => x.metadata?.tool === "create_credit_line").sequenceNumber);
  assert.match(run("host/prove.js", seq).stdout, /ties to anchored root:\s+true/);
  run("host/tamper.js", "--nested-arg");
  assert.match(run("host/prove.js", seq).stdout, /ties to anchored root:\s+false/);
  restore();
});

test("no anchor for the session id: NOT ANCHORED, never VERIFIED", () => {
  const registry = path.join(ws, "data", "rehearsal-anchors.json");
  fs.renameSync(registry, registry + ".off");
  try {
    const r = verify();
    assert.equal(r.status, 1);
    assert.match(r.stdout, /RESULT: NOT ANCHORED/);
    assert.doesNotMatch(r.stdout, /RESULT: VERIFIED/);
  } finally {
    fs.renameSync(registry + ".off", registry);
  }
});

test("an edited session id is not VERIFIED", () => {
  const original = fs.readFileSync(sessionFile(), "utf8");
  const d = JSON.parse(original);
  const nu = "11111111-2222-4333-8444-555555555555";
  d.session.sessionId = nu;
  d.records.forEach((r) => { r.sessionId = nu; });
  fs.writeFileSync(sessionFile(), JSON.stringify(d));
  try {
    const r = verify();
    assert.equal(r.status, 1);
    assert.match(r.stdout, /RESULT: TAMPER DETECTED/);
  } finally {
    fs.writeFileSync(sessionFile(), original);
  }
});

test("a v2 session can't be downgraded to v1", () => {
  const original = fs.readFileSync(sessionFile(), "utf8");
  const d = JSON.parse(original);
  d.canonicalization = "v1";
  d.merkle = "v1";
  fs.writeFileSync(sessionFile(), JSON.stringify(d));
  try {
    const r = verify();
    assert.equal(r.status, 1);
    assert.doesNotMatch(r.stdout, /RESULT: VERIFIED/);
  } finally {
    fs.writeFileSync(sessionFile(), original);
  }
});

test("an older v1 session still verifies, with the v1 warning", () => {
  const m = run("test/make-v1-session.mjs");
  assert.equal(m.status, 0, m.stderr);
  const r = verify();
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /hash_version: v1 \(older session\)/);
  assert.match(r.stdout, /RESULT: VERIFIED/);
});

test("v1's documented gap: a nested-arg edit passes under v1", () => {
  const t = run("host/tamper.js", "--nested-arg");
  assert.equal(t.status, 0, t.stderr);
  assert.match(verify().stdout, /RESULT: VERIFIED/);
});
