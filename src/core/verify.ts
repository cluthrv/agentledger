/**
 * Verify an exported session
 *
 * Applications save sessions (session.export(), written as JSON) and check
 * them later, often in another process or by another party. This verifies such
 * a document on its own, without the AgentLedgerSession that produced it.
 *
 * It checks the document against itself: record hashes, chain linkage, the
 * Merkle root and internal consistency. It does not check signatures or an
 * external anchor; the MCP demo's verifier adds those.
 */

import { ActionRecord, AuditSession, HashVersion, VerificationResult } from '../types';
import { verifyChain } from './recorder';
import { computeMerkleRoot, computeMerkleRootV2 } from './merkle';

/** The shape session.export() produces, as loaded back from JSON. */
export interface ExportedSession {
  session: AuditSession;
  records: ActionRecord[];
  /** Some writers (the MCP demo) also put the versions at the top level. */
  canonicalization?: HashVersion;
  merkle?: HashVersion;
}

/**
 * Verify a session document produced by session.export().
 *
 * The hashing version is read from the document (`session.canonicalization`
 * and `session.merkle`, or the same fields at the top level; absent means v1).
 * Mixed or unknown versions fail.
 *
 * @param doc - The exported session, for example JSON.parse of a saved file
 * @returns A VerificationResult with one entry per check
 */
export function verifyExportedSession(doc: ExportedSession): VerificationResult {
  const checks: VerificationResult['checks'] = [];
  const session = doc?.session;
  const records = Array.isArray(doc?.records) ? doc.records : null;

  if (!session || !records) {
    return {
      valid: false,
      message: 'Not an exported session: expected { session, records }.',
      checks: [{ name: 'document_shape', passed: false, detail: 'expected { session, records }' }],
    };
  }

  // 1. Hashing version, declared consistently.
  const declared = (inner?: string, outer?: string): string | null =>
    inner && outer && inner !== outer ? null : inner ?? outer ?? 'v1';
  const canonicalization = declared(session.canonicalization, doc.canonicalization);
  const merkle = declared(session.merkle, doc.merkle);
  const versionOk =
    canonicalization !== null && canonicalization === merkle && (canonicalization === 'v1' || canonicalization === 'v2');
  checks.push({
    name: 'hash_version',
    passed: versionOk,
    detail: versionOk
      ? canonicalization === 'v2'
        ? 'v2: record hashes cover every field, nested ones included'
        : 'v1: nested fields such as tool arguments are not covered by the record hash'
      : `unsupported or conflicting versions: canonicalization ${canonicalization ?? 'conflicting'}, merkle ${merkle ?? 'conflicting'}`,
  });
  const version: HashVersion = canonicalization === 'v2' ? 'v2' : 'v1';

  // 2. Record hashes and chain linkage.
  const chain = verifyChain(records, version);
  checks.push({
    name: 'hash_chain_integrity',
    passed: chain.valid,
    detail: chain.valid ? `All ${records.length} records have valid hashes and chain linkage` : chain.errors.join('; '),
  });

  // 3. The records belong to this session, and all of them are present.
  const foreign = records.findIndex((r) => r.sessionId !== session.sessionId);
  const countOk = records.length === session.recordCount && records.length > 0;
  checks.push({
    name: 'session_consistency',
    passed: foreign < 0 && countOk,
    detail:
      foreign >= 0
        ? `record ${foreign} belongs to session ${records[foreign].sessionId}, not ${session.sessionId}`
        : countOk
          ? `${records.length} record(s), as the session summary states`
          : `${records.length} record(s), but the session summary states ${session.recordCount}`,
  });

  // 4. The Merkle root, when the session was sealed.
  if (session.merkleRoot) {
    const hashes = records.map((r) => r.hash);
    const recomputed = version === 'v2' ? computeMerkleRootV2(hashes) : computeMerkleRoot(hashes);
    const rootOk = recomputed === session.merkleRoot;
    checks.push({
      name: 'merkle_root_integrity',
      passed: rootOk,
      detail: rootOk
        ? `Merkle root verified: ${session.merkleRoot.substring(0, 16)}...`
        : `Merkle root mismatch: stored ${session.merkleRoot.substring(0, 16)}... vs computed ${String(recomputed).substring(0, 16)}...`,
    });
  }

  const valid = checks.every((c) => c.passed);
  return {
    valid,
    message: valid
      ? `Session ${session.sessionId} verified successfully. ${records.length} records, chain intact.`
      : `Session ${session.sessionId} verification FAILED. See checks for details.`,
    checks,
  };
}
