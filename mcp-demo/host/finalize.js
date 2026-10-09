// ---------------------------------------------------------------------------
// SEAL, ANCHOR, SAVE
// Shared by the CLI (run-record.js) and the UI backend (server.js).
// ---------------------------------------------------------------------------
import fs from "node:fs";
import path from "node:path";
import { anchorBackend, anchoringConfigured, anchorRoot } from "./anchor.js";

export const SESSION_PATH = path.join("data", "sessions", "session.json");
export const BACKUP_PATH = path.join("data", "sessions", "session.backup.json");

export async function sealAndAnchor(host, { onEvent = () => {} } = {}) {
  const sealed = host.seal();
  const verify = host.session.verify();
  const exp = host.exportSession();

  let anchor = null, anchorError = null;
  const backend = anchorBackend();
  if (backend === "rehearsal" || anchoringConfigured()) {
    onEvent({ type: "anchoring", backend });
    try { anchor = await anchorRoot(sealed.sessionId, sealed.merkleRoot); exp.anchor = anchor; }
    catch (e) { anchorError = e.message; onEvent({ type: "anchor_error", message: e.message }); }
  }

  fs.mkdirSync(path.dirname(SESSION_PATH), { recursive: true });
  fs.writeFileSync(SESSION_PATH, JSON.stringify(exp, null, 2));
  fs.rmSync(BACKUP_PATH, { force: true });
  return { sealed, verify, anchor, anchorError, backend };
}
