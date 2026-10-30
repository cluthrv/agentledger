// Installs the packed library into a fresh project and uses it the way an
// application would: the README quick start and a save-and-verify-later flow,
// compiled with strict TypeScript (NodeNext), plus CommonJS and ESM imports.
//   npm run test:package     (builds first; test/package.mjs)
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentledger-package-'));
const run = (cmd, cwd = dir) => execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
const write = (file, text) => { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), text); };

try {
  const tarball = run(`npm pack --silent --pack-destination "${dir}"`, root).trim().split(/\r?\n/).pop();
  write('package.json', JSON.stringify({ name: 'agentledger-package-test', private: true, type: 'module' }));
  run(`npm install --no-audit --no-fund --silent "./${tarball}" typescript@5 @types/node@20`);
  write('tsconfig.json', JSON.stringify({
    compilerOptions: {
      target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true,
      noUncheckedIndexedAccess: true, skipLibCheck: false, outDir: 'out',
    },
    include: ['src'],
  }));

  // The README quick start, exactly as written.
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const quickstart = readme.split('## Quick start')[1]?.match(/```typescript\r?\n([\s\S]*?)```/)?.[1];
  if (!quickstart) throw new Error('README quick start not found');
  write('src/quickstart.ts', quickstart);

  // An application: record, save, reload elsewhere, verify; then tamper.
  write('src/app.ts', `
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { AgentLedgerSession, ActionType, verifyExportedSession, ExportedSession, verifyMerkleProofV2, MerkleProofV2 } from '@vluthra/agent-ledger';

const session = new AgentLedgerSession({ agentId: 'credit-agent', canonicalization: 'v2' });
const args = { customerId: 'MER-100', amount: 2400000 };
session.record({ agentId: 'credit-agent', actionType: ActionType.DECISION, input: {}, output: {}, reasoning: 'Recommend DECLINE' });
session.record({ agentId: 'credit-agent', actionType: ActionType.TOOL_CALL, input: { tool: 'create_credit_line', args }, output: { id: 'CL-5678', createdAt: new Date('2026-10-30T12:00:00Z') } });
args.amount = 1; // the app reuses its own object; the record must not change
session.seal();
fs.writeFileSync('out/session.json', JSON.stringify(session.export()));

const saved = JSON.parse(fs.readFileSync('out/session.json', 'utf8')) as ExportedSession;
assert.equal(verifyExportedSession(saved).valid, true, 'saved session verifies');

const proof = JSON.parse(JSON.stringify(session.proveRecord(1))) as MerkleProofV2;
assert.equal(verifyMerkleProofV2(proof) && proof.root === saved.session.merkleRoot, true, 'proof verifies on its own');

(saved.records[1]!.input.args as Record<string, unknown>).amount = 240000;
assert.equal(verifyExportedSession(saved).valid, false, 'nested edit is caught');
console.log('app: save, reload, verify, prove and tamper detection all behave');
`);

  run('npx tsc -p .');
  const quick = run('node out/quickstart.js');
  if (!/Verification: PASSED/.test(quick) || !/Proof valid: true/.test(quick)) throw new Error('README quick start output unexpected:\n' + quick);
  const app = run('node out/app.js');
  write('cjs.cjs', "const l = require('@vluthra/agent-ledger'); if (typeof l.verifyExportedSession !== 'function') process.exit(1);");
  run('node cjs.cjs');
  write('esm.mjs', "import { AgentLedgerSession, verifyExportedSession } from '@vluthra/agent-ledger'; if (typeof AgentLedgerSession !== 'function' || typeof verifyExportedSession !== 'function') process.exit(1);");
  run('node esm.mjs');

  console.log(`package: ${tarball}`);
  console.log('quick start (README, strict TypeScript): compiles and runs');
  console.log(app.trim());
  console.log('CommonJS require and ESM import: work');
  console.log('PACKAGE TEST PASSED');
} catch (e) {
  console.error('PACKAGE TEST FAILED');
  console.error(e.stdout || '', e.stderr || '', e.message);
  process.exitCode = 1;
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
