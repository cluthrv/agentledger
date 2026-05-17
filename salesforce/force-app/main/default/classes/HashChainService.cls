/**
 * HashChainService
 *
 * Provides SHA-256 hashing and hash chain operations for AgentLedger.
 * Uses the Apex Crypto class for all cryptographic operations.
 *
 * This is the Salesforce-native equivalent of the hash.ts and recorder.ts
 * modules in the open-source AgentLedger npm package.
 */
public with sharing class HashChainService {

    /**
     * Compute SHA-256 hash of an arbitrary string.
     * @param data The string to hash
     * @return 64-character lowercase hex string
     */
    public static String sha256(String data) {
        Blob hashBlob = Crypto.generateDigest('SHA-256', Blob.valueOf(data));
        return EncodingUtil.convertToHex(hashBlob);
    }

    /**
     * Compute the hash of an Agent Audit Record's content fields.
     * Uses deterministic serialization with fixed field order to ensure
     * identical inputs always produce identical hashes.
     *
     * @param record The Agent_Audit_Record__c to hash
     * @return SHA-256 hash as 64-character hex string
     */
    public static String hashActionRecord(Agent_Audit_Record__c record) {
        // Build canonical string with fixed field order
        // This must match the serialization order in the npm package
        List<String> parts = new List<String>();
       // parts.add(safeString(record.Id));
        parts.add(safeString(record.Audit_Session__c));
        parts.add(String.valueOf(record.Sequence_Number__c != null ? record.Sequence_Number__c.intValue() : 0));
        parts.add(safeString(String.valueOf(record.Action_Timestamp__c)));
        parts.add(safeString(record.Agent_Id__c));
        parts.add(safeString(record.Action_Type__c));
        parts.add(safeString(record.Input_Context__c));
        parts.add(safeString(record.Output_Result__c));
        parts.add(safeString(record.Reasoning__c));
        parts.add(safeString(record.Previous_Hash__c));

        String canonical = JSON.serialize(parts);
        return sha256(canonical);
    }

    /**
     * Combine two hashes for Merkle tree construction.
     * Concatenates left + right and hashes the result.
     *
     * @param leftHash Left child hash
     * @param rightHash Right child hash
     * @return Combined hash
     */
    public static String combineHashes(String leftHash, String rightHash) {
        return sha256(leftHash + rightHash);
    }

    /**
     * Verify that a single Action Record's hash is valid.
     * Recomputes the hash from the record's fields and compares
     * it to the stored hash.
     *
     * @param record The record to verify
     * @return true if the stored hash matches the recomputed hash
     */
    public static Boolean verifyRecord(Agent_Audit_Record__c record) {
        String recomputed = hashActionRecord(record);
        return recomputed == record.Record_Hash__c;
    }

    /**
     * Verify the integrity of an entire chain of Action Records.
     * Records must be ordered by Sequence_Number__c ascending.
     *
     * Checks:
     * 1. Each record's hash is valid (content not modified)
     * 2. Each record's Previous_Hash__c matches the prior record's hash
     * 3. Sequence numbers are contiguous starting from 0
     * 4. First record's Previous_Hash__c is null
     *
     * @param records List of records ordered by sequence number
     * @return VerificationResult with details
     */
    public static VerificationResult verifyChain(List<Agent_Audit_Record__c> records) {
        VerificationResult result = new VerificationResult();
        result.valid = true;
        result.errors = new List<String>();
        result.recordsChecked = records.size();

        if (records.isEmpty()) {
            return result;
        }

        // Check first record
        if (String.isNotBlank(records[0].Previous_Hash__c)) {
            result.valid = false;
            result.errors.add('First record must have null Previous Hash');
        }

        if (records[0].Sequence_Number__c != 0) {
            result.valid = false;
            result.errors.add('First record has sequence number ' +
                records[0].Sequence_Number__c.intValue() + ', expected 0');
        }

        for (Integer i = 0; i < records.size(); i++) {
            Agent_Audit_Record__c record = records[i];

            // Verify sequence number
            if (record.Sequence_Number__c != i) {
                result.valid = false;
                result.errors.add('Record ' + i + ': sequence number is ' +
                    record.Sequence_Number__c.intValue() + ', expected ' + i);
            }

            // Verify record hash integrity
            if (!verifyRecord(record)) {
                result.valid = false;
                result.errors.add('Record ' + i + ' (' + record.Name +
                    '): hash verification failed — content may have been tampered with');
            }

            // Verify chain linkage (skip first record)
            if (i > 0) {
                Agent_Audit_Record__c previous = records[i - 1];
                if (record.Previous_Hash__c != previous.Record_Hash__c) {
                    result.valid = false;
                    result.errors.add('Record ' + i + ' (' + record.Name +
                        '): Previous Hash does not match hash of record ' + (i - 1) +
                        ' — chain is broken');
                }
            }
        }

        return result;
    }

    private static String safeString(String value) {
        return value != null ? value : '';
    }

    /**
     * Result object for chain verification operations.
     */
    public class VerificationResult {
        @AuraEnabled public Boolean valid;
        @AuraEnabled public List<String> errors;
        @AuraEnabled public Integer recordsChecked;
    }
}
