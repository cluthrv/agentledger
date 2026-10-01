// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Minimal anchor: records the block time at which a Merkle root was committed.
/// Content-discoverable: given a root, anyone can read anchoredAt(root) with no
/// pointer stored anywhere off-chain. The indexed event also lets you find it by log.
contract AnchorRegistry {
    mapping(bytes32 => uint256) public anchoredAt; // root -> block timestamp
    event Anchored(bytes32 indexed root, uint256 timestamp);

    function anchor(bytes32 root) external {
        require(anchoredAt[root] == 0, "already anchored");
        anchoredAt[root] = block.timestamp;
        emit Anchored(root, block.timestamp);
    }
}
