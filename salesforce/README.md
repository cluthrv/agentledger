# AgentLedger for Salesforce

Salesforce-native implementation of AgentLedger's cryptographic audit trail framework. Integrates with Agentforce to record every AI agent decision using SHA-256 hash chains and Merkle trees.

## What's Here

- **Custom Objects**: Agent_Audit_Session__c and Agent_Audit_Record__c for storing cryptographic audit trails
- **Core Apex Classes**: HashChainService, MerkleTreeService, AgentAuditRecorder
- **Agentforce Actions**: 6 Invocable Actions that wrap business logic with automatic audit recording
- **Lightning Web Components**: Visual audit trail viewer, demo interfaces, tamper detection
- **Test Classes**: Full coverage across core framework, Agentforce integration, and UI controllers

## Deployment

```bash
sf org login web --alias agentledger-dev
sf project deploy start --source-dir force-app --target-org agentledger-dev
sf org assign permset --name AgentLedger_Admin --target-org agentledger-dev
```

## Documentation

See [GUIDE.md](GUIDE.md) for the complete technical guide covering architecture, every class and method, test procedures, and deployment instructions.

## Related

- [Core TypeScript library](../) (npm: @vluthra/agent-ledger)
- [Visual HTML demo](../examples/visual-demo.html)
