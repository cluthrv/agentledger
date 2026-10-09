"""
On-chain anchor verification against a fake JSON-RPC endpoint.

The fake answers eth_call for AnchorRegistry.anchors(address,bytes32) from an
in-memory table, so these tests exercise the calldata encoding, result decoding,
and pass/fail logic without a network.
"""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from agentledger import (
    ActionType,
    AgentLedgerSession,
    OnChainAnchor,
    compute_merkle_root,
    hash_action_record,
    load_records,
    session_id_to_bytes32,
    verify_exported_session,
)
from agentledger.verification import ANCHORS_SELECTOR

CONTRACT = "0xe78a0f7e598cc8b0bb87894b0f60dd2a88d6a8ab"
GATEWAY = "0x90f8bf6a479f320ead074411a4b0e7944ea8c9c1"
OTHER = "0xffcf8fdee72ac11b5c542428b35eef5769c409f0"


class FakeChain:
    def __init__(self):
        self.anchors = {}  # (anchorer, sessionId bytes32 hex) -> (root hex, ts)

    def handle(self, req):
        assert req["method"] == "eth_call"
        call = req["params"][0]
        assert call["to"].lower() == CONTRACT
        data = call["data"][2:]
        assert data[:8] == ANCHORS_SELECTOR
        anchorer = "0x" + data[8:72][-40:]
        sid = data[72:136]
        root, ts = self.anchors.get((anchorer, sid), ("0" * 64, 0))
        return {"jsonrpc": "2.0", "id": req["id"], "result": "0x" + root + format(ts, "064x")}


@pytest.fixture
def chain():
    fake = FakeChain()

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["content-length"])))
            out = json.dumps(fake.handle(body)).encode()
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(out)))
            self.end_headers()
            self.wfile.write(out)

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    fake.url = f"http://127.0.0.1:{server.server_port}"
    yield fake
    server.shutdown()


def _sealed_doc():
    s = AgentLedgerSession(agent_id="credit-agent")
    s.record(action_type=ActionType.QUERY, input={"customerId": "MER-100"}, output={"score": 580})
    s.record(action_type=ActionType.DECISION, input={}, output={}, reasoning="DECLINE")
    s.seal()
    return s.export()


def _rehash(rec_dict):
    r = load_records({"records": [rec_dict]})[0]
    return hash_action_record(
        id=r.id, session_id=r.session_id, sequence_number=r.sequence_number,
        timestamp=r.timestamp, agent_id=r.agent_id, action_type=rec_dict["actionType"],
        input=r.input, output=r.output, reasoning=r.reasoning, metadata=r.metadata,
        previous_hash=r.previous_hash,
    )


def _cfg(chain, anchorers=(GATEWAY,)):
    return OnChainAnchor(rpc_url=chain.url, contract=CONTRACT, trusted_anchorers=list(anchorers))


def _check(result):
    return {c.name: c for c in result.checks}["anchored_root_onchain"]


def test_session_id_encoding():
    assert session_id_to_bytes32("35e1803a-0000-4000-8000-0000000000ff") == "0" * 32 + "35e1803a000040008000" + "0000000000ff"
    with pytest.raises(ValueError):
        session_id_to_bytes32("not-a-uuid")


def test_matching_onchain_root_passes(chain):
    doc = _sealed_doc()
    sid = session_id_to_bytes32(doc["session"]["sessionId"])
    chain.anchors[(GATEWAY, sid)] = (doc["session"]["merkleRoot"], 1_760_000_000)
    result = verify_exported_session(doc, onchain=_cfg(chain))
    assert result.valid
    assert _check(result).passed


def test_forged_file_fails_even_with_rewritten_cached_anchor(chain):
    doc = _sealed_doc()
    sid = session_id_to_bytes32(doc["session"]["sessionId"])
    chain.anchors[(GATEWAY, sid)] = (doc["session"]["merkleRoot"], 1_760_000_000)

    # Forger edits a record, re-hashes, re-chains, re-seals, and rewrites the
    # cached anchor to match.
    doc["records"][0]["output"] = {"score": 720}
    doc["records"][0]["hash"] = _rehash(doc["records"][0])
    doc["records"][1]["previousHash"] = doc["records"][0]["hash"]
    doc["records"][1]["hash"] = _rehash(doc["records"][1])
    new_root = compute_merkle_root([r["hash"] for r in doc["records"]])
    doc["session"]["merkleRoot"] = new_root
    doc["anchor"] = {"chain": "arbitrum-sepolia", "root": "0x" + new_root}

    offline = verify_exported_session(doc)
    assert offline.valid, "the cached anchor alone can't catch a full forgery"

    result = verify_exported_session(doc, onchain=_cfg(chain))
    assert not result.valid
    assert not _check(result).passed
    assert "does NOT match" in _check(result).detail


def test_anchor_from_untrusted_address_is_ignored(chain):
    doc = _sealed_doc()
    sid = session_id_to_bytes32(doc["session"]["sessionId"])
    chain.anchors[(OTHER, sid)] = (doc["session"]["merkleRoot"], 1_760_000_000)
    result = verify_exported_session(doc, onchain=_cfg(chain))
    assert not result.valid
    assert "No anchor" in _check(result).detail


def test_unreachable_rpc_fails_closed():
    doc = _sealed_doc()
    cfg = OnChainAnchor(rpc_url="http://127.0.0.1:9", contract=CONTRACT, trusted_anchorers=[GATEWAY], timeout=2)
    result = verify_exported_session(doc, onchain=cfg)
    assert not result.valid
    assert "Could not read" in _check(result).detail
