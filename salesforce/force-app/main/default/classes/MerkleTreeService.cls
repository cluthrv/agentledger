/**
 * MerkleTreeService
 *
 * Builds Merkle trees from Action Record hashes, computes root hashes,
 * generates proofs, and verifies proofs.
 *
 * Designed to work within Salesforce governor limits. Tree construction
 * is performed in-memory using Lists rather than recursive structures.
 */
public with sharing class MerkleTreeService {

    /**
     * Compute the Merkle root from a list of Action Record hashes.
     * If the number of hashes is odd, the last hash is duplicated
     * to create a balanced tree.
     *
     * @param hashes List of SHA-256 hashes from Action Records
     * @return The Merkle root hash, or null if input is empty
     */
    public static String computeMerkleRoot(List<String> hashes) {
        if (hashes == null || hashes.isEmpty()) {
            return null;
        }

        // Create leaf nodes by hashing each record hash
        List<String> currentLevel = new List<String>();
        for (String h : hashes) {
            currentLevel.add(HashChainService.sha256(h));
        }

        // Build tree bottom-up
        while (currentLevel.size() > 1) {
            List<String> nextLevel = new List<String>();

            for (Integer i = 0; i < currentLevel.size(); i += 2) {
                String left = currentLevel[i];
                // If odd number, duplicate the last node
                String right = (i + 1 < currentLevel.size())
                    ? currentLevel[i + 1]
                    : currentLevel[i];

                nextLevel.add(HashChainService.combineHashes(left, right));
            }

            currentLevel = nextLevel;
        }

        return currentLevel[0];
    }

    /**
     * Generate a Merkle proof for a specific record.
     * The proof contains sibling hashes needed to recompute
     * the root from the target leaf.
     *
     * @param hashes All Action Record hashes in the session
     * @param recordIndex Index of the record to prove
     * @return MerkleProof object, or null if index is out of bounds
     */
    public static MerkleProof generateProof(List<String> hashes, Integer recordIndex) {
        if (hashes == null || hashes.isEmpty() ||
            recordIndex < 0 || recordIndex >= hashes.size()) {
            return null;
        }

        String root = computeMerkleRoot(hashes);
        if (root == null) {
            return null;
        }

        // Build leaf hashes
        List<String> leafHashes = new List<String>();
        for (String h : hashes) {
            leafHashes.add(HashChainService.sha256(h));
        }

        List<ProofSibling> siblings = new List<ProofSibling>();
        List<String> currentLevel = new List<String>(leafHashes);
        Integer targetIndex = recordIndex;

        while (currentLevel.size() > 1) {
            List<String> nextLevel = new List<String>();

            for (Integer i = 0; i < currentLevel.size(); i += 2) {
                String left = currentLevel[i];
                String right = (i + 1 < currentLevel.size())
                    ? currentLevel[i + 1]
                    : currentLevel[i];

                // If target is in this pair, collect sibling
                if (i == targetIndex || i + 1 == targetIndex) {
                    ProofSibling sibling = new ProofSibling();
                    if (Math.mod(targetIndex, 2) == 0) {
                        sibling.hash = right;
                        sibling.position = 'right';
                    } else {
                        sibling.hash = left;
                        sibling.position = 'left';
                    }
                    siblings.add(sibling);
                }

                nextLevel.add(HashChainService.combineHashes(left, right));
            }

            currentLevel = nextLevel;
            targetIndex = targetIndex / 2;
        }

        MerkleProof proof = new MerkleProof();
        proof.recordIndex = recordIndex;
        proof.recordHash = hashes[recordIndex];
        proof.siblings = siblings;
        proof.root = root;

        return proof;
    }

    /**
     * Verify a Merkle proof against a claimed root hash.
     *
     * @param proof The MerkleProof to verify
     * @return true if the proof is valid
     */
    public static Boolean verifyProof(MerkleProof proof) {
        if (proof == null || proof.siblings == null) {
            return false;
        }

        String currentHash = HashChainService.sha256(proof.recordHash);

        for (ProofSibling sibling : proof.siblings) {
            if (sibling.position == 'right') {
                currentHash = HashChainService.combineHashes(currentHash, sibling.hash);
            } else {
                currentHash = HashChainService.combineHashes(sibling.hash, currentHash);
            }
        }

        return currentHash == proof.root;
    }

    /**
     * Seal a session by computing the Merkle root from its records.
     * Updates the session record with the root hash and sealed status.
     *
     * @param sessionId The Salesforce record Id of the Agent_Audit_Session__c
     * @return The computed Merkle root hash
     */
    public static String sealSession(Id sessionId) {
        List<Agent_Audit_Record__c> records = [
            SELECT Record_Hash__c
            FROM Agent_Audit_Record__c
            WHERE Audit_Session__c = :sessionId
            ORDER BY Sequence_Number__c ASC
        ];

        if (records.isEmpty()) {
            throw new AgentLedgerException('Cannot seal an empty session.');
        }

        List<String> hashes = new List<String>();
        for (Agent_Audit_Record__c record : records) {
            hashes.add(record.Record_Hash__c);
        }

        String merkleRoot = computeMerkleRoot(hashes);

        Agent_Audit_Session__c session = new Agent_Audit_Session__c(
            Id = sessionId,
            Merkle_Root__c = merkleRoot,
            Status__c = 'Sealed',
            End_Time__c = DateTime.now(),
            Record_Count__c = records.size()
        );
        update session;

        return merkleRoot;
    }

    /**
     * Represents a Merkle proof for a single record.
     */
    public class MerkleProof {
        @AuraEnabled public Integer recordIndex;
        @AuraEnabled public String recordHash;
        @AuraEnabled public List<ProofSibling> siblings;
        @AuraEnabled public String root;
    }

    /**
     * A sibling hash in a Merkle proof path.
     */
    public class ProofSibling {
        @AuraEnabled public String hash;
        @AuraEnabled public String position; // 'left' or 'right'
    }

    public class AgentLedgerException extends Exception {}
}
