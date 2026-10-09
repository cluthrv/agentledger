// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Anchors one Merkle root per (anchorer, session). Write-once: a session can't
/// be re-anchored, and because the slot is keyed by msg.sender, nobody else can
/// claim or squat on a session's slot. A verifier pins the anchorer address it
/// trusts (the gateway's wallet) and reads anchors(anchorer, sessionId) - so a
/// forged session file can't point the verifier at a root of the forger's choosing.
contract AnchorRegistry {
    struct Anchor {
        bytes32 root;
        uint64 anchoredAt; // block timestamp
    }

    mapping(address => mapping(bytes32 => Anchor)) public anchors; // anchorer -> sessionId -> anchor

    event Anchored(address indexed anchorer, bytes32 indexed sessionId, bytes32 indexed root, uint256 timestamp);

    function anchor(bytes32 sessionId, bytes32 root) external {
        require(root != bytes32(0), "empty root");
        require(anchors[msg.sender][sessionId].anchoredAt == 0, "session already anchored");
        anchors[msg.sender][sessionId] = Anchor(root, uint64(block.timestamp));
        emit Anchored(msg.sender, sessionId, root, block.timestamp);
    }
}
