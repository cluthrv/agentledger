import { LightningElement, track } from 'lwc';
import startDemoSession from '@salesforce/apex/AgentLedgerDemoController.startDemoSession';
import executeStep from '@salesforce/apex/AgentLedgerDemoController.executeStep';
import sealDemoSession from '@salesforce/apex/AgentLedgerDemoController.sealDemoSession';
import verifyDemoSession from '@salesforce/apex/AgentLedgerDemoController.verifyDemoSession';
import generateRecordProof from '@salesforce/apex/AgentLedgerDemoController.generateRecordProof';

const STEP_DEFS = [
    { number: 0, label: 'Dealer Lookup', actionType: 'Query' },
    { number: 1, label: 'Credit Validation', actionType: 'Validation' },
    { number: 2, label: 'Catalog Query', actionType: 'Query' },
    { number: 3, label: 'Handle Unavailable', actionType: 'Decision' },
    { number: 4, label: 'Pricing Rules', actionType: 'Query' },
    { number: 5, label: 'Calculate Pricing', actionType: 'Calculation' },
    { number: 6, label: 'Floor Price Check', actionType: 'Validation' },
    { number: 7, label: 'Credit Limit Check', actionType: 'Validation' },
    { number: 8, label: 'Generate Quote', actionType: 'Create' }
];

const TYPE_BADGE = {
    Query: 'badge-query',
    Validation: 'badge-validation',
    Decision: 'badge-decision',
    Calculation: 'badge-calculation',
    Create: 'badge-create'
};

export default class AgentLedgerDemo extends LightningElement {
    sessionId;
    @track auditRecords = [];
    @track currentStep = -1;
    isRunning = false;
    isSealed = false;
    isVerified = false;
    sealResult;
    verifyMessage = '';
    @track verifyChecks = [];
    @track proofResult;

    get showEmptyState() {
        return this.auditRecords.length === 0 && !this.isRunning;
    }

    get runButtonLabel() {
        return this.isRunning ? 'Running Agent...' : 'Run Pricing Agent';
    }

    get recordCountLabel() {
        const count = this.auditRecords.length;
        const suffix = this.isSealed ? ' \u2022 SEALED' : '';
        return `${count} / 9 records${suffix}`;
    }

    get steps() {
        return STEP_DEFS.map(s => {
            const done = s.number <= this.currentStep;
            const active = s.number === this.currentStep && this.isRunning;
            return {
                ...s,
                displayNumber: s.number + 1,
                done,
                cssClass: `step-item ${done ? 'step-done' : ''} ${active ? 'step-active' : ''}`,
                iconCss: `step-icon ${done ? 'step-icon-done' : ''}`,
                labelCss: `step-label ${done ? 'step-label-done' : ''}`
            };
        });
    }

    get proofButtons() {
        return this.auditRecords.map(r => ({
            index: r.sequenceNumber,
            label: `#${r.sequenceNumber} ${r.label}`
        }));
    }

    get proofShortHash() {
        return this.proofResult ? this.proofResult.recordHash.substring(0, 24) + '...' : '';
    }

    get proofValidClass() {
        return this.proofResult && this.proofResult.isValid ? 'proof-valid' : 'proof-invalid';
    }

    async handleRunAgent() {
        this.isRunning = true;
        this.auditRecords = [];
        this.currentStep = -1;
        this.isSealed = false;
        this.isVerified = false;
        this.sealResult = null;
        this.verifyChecks = [];
        this.proofResult = null;

        try {
            // Start session
            this.sessionId = await startDemoSession();

            // Execute steps one by one with delay
            for (let i = 0; i <= 8; i++) {
                // eslint-disable-next-line no-await-in-loop
                await this.delay(600);
                // eslint-disable-next-line no-await-in-loop
                const result = await executeStep({
                    sessionId: this.sessionId,
                    stepNumber: i
                });

                this.currentStep = i;
                this.auditRecords = [...this.auditRecords, {
                    sequenceNumber: result.sequenceNumber,
                    label: result.label,
                    actionType: result.actionType,
                    icon: result.icon,
                    reasoning: result.reasoning,
                    recordHash: result.recordHash,
                    shortHash: result.recordHash.substring(0, 16) + '...',
                    previousHash: result.previousHash,
                    shortPrevHash: result.previousHash ? result.previousHash.substring(0, 16) + '...' : null,
                    isFirst: i === 0,
                    prevIndex: i - 1,
                    cardClass: `audit-card card-${result.actionType.toLowerCase()}`,
                    badgeClass: `rec-badge ${TYPE_BADGE[result.actionType] || 'badge-query'}`
                }];

                this.scrollToBottom();
            }

            // Seal
            await this.delay(500);
            this.sealResult = await sealDemoSession({ sessionId: this.sessionId });
            this.isSealed = true;
            this.scrollToBottom();

            // Verify
            await this.delay(400);
            const verifyResult = await verifyDemoSession({ sessionId: this.sessionId });
            this.isVerified = true;
            this.verifyMessage = `${this.sealResult.recordCount} records, chain intact`;
            this.verifyChecks = verifyResult.checks;
            this.scrollToBottom();

        } catch (error) {
            console.error('AgentLedger Demo Error:', error);
        } finally {
            this.isRunning = false;
        }
    }

    async handleProofClick(event) {
        const index = parseInt(event.target.dataset.index, 10);
        try {
            this.proofResult = await generateRecordProof({
                sessionId: this.sessionId,
                recordIndex: index
            });
            this.scrollToBottom();
        } catch (error) {
            console.error('Proof generation error:', error);
        }
    }

    handleReset() {
        this.sessionId = null;
        this.auditRecords = [];
        this.currentStep = -1;
        this.isRunning = false;
        this.isSealed = false;
        this.isVerified = false;
        this.sealResult = null;
        this.verifyChecks = [];
        this.proofResult = null;
    }

    delay(ms) {
        return new Promise(resolve => {
            // eslint-disable-next-line @lwc/lwc/no-async-operation
            setTimeout(resolve, ms);
        });
    }

    scrollToBottom() {
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        setTimeout(() => {
            const scrollEl = this.refs.auditScroll;
            if (scrollEl) {
                scrollEl.scrollTop = scrollEl.scrollHeight;
            }
        }, 100);
    }
}
