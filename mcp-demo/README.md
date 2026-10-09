# AgentLedger MCP demo

A credit-operations agent calls tools on five MCP servers through a capture
gateway. Every `tools/call` and every declared decision becomes a hashed,
chained, signed receipt. The session is sealed, its Merkle root is anchored on
Arbitrum Sepolia, and a verifier checks the evidence against sources the
session file can't rewrite.

## Setup
    cd mcp-demo
    npm install
    copy .env.example .env      # then fill it in
    npm run deploy              # deploys AnchorRegistry; put the address in .env

The contract changed (roots are now keyed by anchorer and session id). If you
deployed the earlier version, run `npm run deploy` again and update
`ANCHOR_CONTRACT_ADDRESS`. Sessions anchored to the old contract won't verify
on chain; record a fresh one.

## Run the UI
    npm run ui
Then open http://localhost:4000.

## Two modes
- LIVE (default): the Run button calls the real model and anchors to Arbitrum
  (needs your .env and internet). Use this for the real talk.
- REHEARSAL (offline): a scripted agent, no API calls, no network.
      $env:DEMO_MOCK="1"; npm run ui
  With no chain configured, anchors go to `data/rehearsal-anchors.json`, a
  write-once registry outside the session file that stands in for the chain,
  so every tamper mode is still caught offline.

## What gets signed and anchored
- **Gateway receipts.** The gateway signs each record hash with its Ed25519 key
  and returns the receipt to the caller in the MCP result's
  `_meta["io.agentledger/receipt"]`.
- **Checkpoints.** Every `CHECKPOINT_EVERY` records (default 5) the gateway signs
  the running Merkle root, and appends it to `data/checkpoints/<session>.jsonl`
  as it goes, so a long or crashed session still has signed commitments. The
  seal is the final checkpoint.
- **Server receipts.** The credit bureau signs its own result (args hash, result
  hash) and returns it in `_meta["io.agentledger/server-receipt"]`. The gateway
  stores it inside the record, so the score is backed by two signers: the client
  side and the server side.
- **Anchor.** The sealed root goes on chain as `anchor(sessionId, root)`. The
  contract stores it under `msg.sender`, write-once.

## What the verifier trusts
Nothing in the session file on its own word. It pins:
- the anchor source (RPC URL and contract) and the trusted anchorer address
  (`ANCHOR_TRUSTED_ADDRESSES`, default: your anchoring wallet), and reads
  `anchors(anchorer, sessionId)` from the chain;
- the gateway's public key (`data/keys/gateway.pub.pem` or `GATEWAY_PUBLIC_KEY`);
- each signing server's public key (`data/keys/bureau.pub.pem`). A server with a
  pinned key must have signed every result it returned.

In production those pins belong somewhere the operator can't rewrite (a config
repo, a KMS, the auditor's machine). In the demo they sit on disk.

Results: **VERIFIED** (everything passed, including an independent anchor),
**INTACT** (consistent, but no independent anchor was checked), **TAMPER
DETECTED**, or **COULD NOT VERIFY** (the chain was unreachable; nothing failed,
nothing independent was checked).

The Python verifier can do the on-chain check too:
`verify_exported_session(doc, onchain=OnChainAnchor(...))`.

## Tamper modes
Each is a stronger attacker:

| Mode  | What the attacker rewrites | What catches it |
|-------|----------------------------|-----------------|
| naive | one field                  | record hash, bureau receipt (if a bureau record) |
| smart | the field, then re-hashes, re-chains, re-seals | gateway signatures, on-chain root |
| forge | everything in the file: re-seal, the cached anchor root, every signature (with the attacker's own key), and strips the bureau receipt it can't re-sign | pinned gateway key, required bureau receipt, on-chain root |

The forged file is fully self-consistent. Only the pinned keys and the chain
catch it. Turn off the chain (no RPC configured, no `DEMO_MOCK`) and the
verifier falls back to the cached anchor, which the forgery passes; that check
is labelled NOT independent.

## Suggested on-stage flow
Run -> Investigate -> Verify -> Tamper (naive) -> Tamper (smart) ->
Tamper (forge) -> Restore, then the single-action proof (`npm run prove -- 2`).

## Headless
    npm run record                         # run, seal, sign, anchor
    npm run verify
    npm run tamper -- 2 output.score 720 [--smart | --forge]
    npm run restore
    npm run prove -- 2
The terminal path is your fallback if the browser misbehaves on the day.
`DEMO_MOCK=1` works for `npm run record` too.
