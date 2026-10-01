# AgentLedger MCP - Phase 7: the UI (complete app)

A local web app over the same backend. Four screens: Run, Investigate, Verify,
Tamper. Self-contained, no external CDNs, works offline.

## Run the UI
    cd C:\Users\vikas\agentledger-mcp
    npm install
    npm run ui
Then open http://localhost:4000 in your browser.

## Two modes
- LIVE (default): the Run button calls the real model and anchors to Arbitrum
  (needs your .env and internet). Use this for the real talk.
- REHEARSAL (offline): run with a scripted agent, no API calls, no network.
      $env:DEMO_MOCK="1"; npm run ui
  A rehearsal anchor is injected so the smart-tamper catch still works offline.
  Great for practicing without wifi or burning API credits.

## The four screens
1. Run        - click Run; watch the agent stream on the left and receipts
                appear at the boundary on the right; ends with the sealed root
                and (live mode) an Arbiscan link.
2. Investigate - click Load session; the run is reconstructed as a timeline;
                the DECLINE recommendation (red) and the VP override (amber) stand out.
3. Verify     - click Verify; the three checks and the anchored-root result.
4. Tamper     - pick a record and field, optionally check Smart, click Apply &
                verify; watch it get caught. Restore resets.

## Suggested on-stage flow
Run  ->  Investigate  ->  Verify  ->  Tamper (naive)  ->  Tamper (smart)  ->
back to Verify, then mention the single-action proof (npm run prove -- 9).

## Everything from Phase 6 still works headlessly
    npm run record / verify / tamper / restore / prove / scenario
The terminal path is your fallback if the browser misbehaves on the day.

## Files added
- host/server.js      express + websocket backend
- host/ops.js         tamper / restore / prove as importable functions
- host/mock-model.js  scripted agent for offline rehearsal
- ui/index.html       the whole UI, self-contained
