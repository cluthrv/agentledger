import { LightningElement, track } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import setupDemoData from '@salesforce/apex/OpportunityAgentDemoController.setupDemoData';
import executeStep from '@salesforce/apex/OpportunityAgentDemoController.executeStep';
import sealSession from '@salesforce/apex/OpportunityAgentDemoController.sealSession';
import verifySession from '@salesforce/apex/OpportunityAgentDemoController.verifySession';
import generateProof from '@salesforce/apex/OpportunityAgentDemoController.generateProof';
import simulateTampering from '@salesforce/apex/OpportunityAgentDemoController.simulateTampering';
import restoreTamperedRecord from '@salesforce/apex/OpportunityAgentDemoController.restoreTamperedRecord';
import startSession from '@salesforce/apex/AgentLedgerDemoController.startDemoSession';

const TYPE_BADGE = {
    Query: 'badge badge-query',
    Validation: 'badge badge-validation',
    Decision: 'badge badge-decision',
    Calculation: 'badge badge-calculation',
    Create: 'badge badge-create',
    Update: 'badge badge-update'
};

const TYPE_CARD = {
    Query: 'audit-card card-query',
    Validation: 'audit-card card-validation',
    Decision: 'audit-card card-decision',
    Calculation: 'audit-card card-calculation',
    Create: 'audit-card card-create',
    Update: 'audit-card card-update'
};

export default class OpportunityAgentDemo extends NavigationMixin(LightningElement) {
    @track isStarted = false;
    @track isProcessing = false;
    @track isSealed = false;
    @track isVerified = false;
    @track isFinished = false;
    @track isTampering = false;
    @track isRestored = false;

    sessionId;
    @track setupData;
    @track auditRecords = [];
    @track sealData;
    @track verifyChecks = [];
    @track proofResult;
    @track tamperResult;

    @track statusMessage = '';
    @track currentStage = 'Prospecting';

    get stageClass() {
        return this.currentStage === 'Qualification' ? 'context-value stage-advanced' : 'context-value';
    }

    get trailCountLabel() {
        const count = this.auditRecords.length;
        if (this.isSealed) return count + ' records | SEALED & VERIFIED';
        if (count === 0) return 'Waiting for agent...';
        return count + ' / 7 records';
    }

    get statusClass() {
        return 'status-banner' + (this.isProcessing ? ' status-active' : ' status-done');
    }

    get proofShortHash() {
        return this.proofResult ? this.proofResult.recordHash.substring(0, 28) + '...' : '';
    }

    get proofResultClass() {
        return this.proofResult && this.proofResult.isValid ? 'proof-result proof-valid' : 'proof-result proof-invalid';
    }

    get proofVerdictIcon() {
        return this.proofResult && this.proofResult.isValid ? 'utility:success' : 'utility:error';
    }

    get proofVerdictText() {
        return this.proofResult && this.proofResult.isValid
            ? 'Proof VALID: This record is mathematically verified as part of the sealed session'
            : 'Proof INVALID: Tampering detected';
    }

    async handleStart() {
        this.isStarted = true;
        this.isProcessing = true;
        this.statusMessage = 'Setting up demo data...';

        try {
            this.setupData = await setupDemoData();
            this.currentStage = this.setupData.stage;

            this.statusMessage = 'Starting AgentLedger audit session...';
            this.sessionId = await startSession();

            await this.delay(500);

            const stepLabels = [
                'Looking up opportunity...',
                'Checking account health...',
                'Classifying deal size...',
                'Assessing win probability...',
                'Evaluating stage advancement...',
                'Updating opportunity record...',
                'Creating follow-up task...'
            ];

            for (let i = 0; i <= 6; i++) {
                this.statusMessage = stepLabels[i];
                // eslint-disable-next-line no-await-in-loop
                await this.delay(800);

                // eslint-disable-next-line no-await-in-loop
                const result = await executeStep({
                    sessionId: this.sessionId,
                    stepNumber: i,
                    opportunityId: this.setupData.opportunityId,
                    accountId: this.setupData.accountId
                });

                if (i === 5) {
                    this.currentStage = 'Qualification';
                }

                this.auditRecords = [...this.auditRecords, {
                    sequenceNumber: result.sequenceNumber,
                    label: result.label,
                    actionType: result.actionType,
                    icon: result.icon,
                    description: result.description,
                    reasoning: result.reasoning,
                    displaySummary: result.displaySummary,
                    recordHash: result.recordHash,
                    shortHash: result.recordHash.substring(0, 20) + '...',
                    previousHash: result.previousHash,
                    isFirst: i === 0,
                    prevIndex: i - 1,
                    cardClass: TYPE_CARD[result.actionType] || 'audit-card card-query',
                    badgeClass: TYPE_BADGE[result.actionType] || 'badge badge-query'
                }];
            }

            this.statusMessage = 'Sealing session with Merkle root...';
            await this.delay(600);
            this.sealData = await sealSession({ sessionId: this.sessionId });
            this.isSealed = true;

            this.statusMessage = 'Verifying cryptographic integrity...';
            await this.delay(400);
            const verifyResult = await verifySession({ sessionId: this.sessionId });
            this.verifyChecks = verifyResult.checks.map(c => ({
                ...c,
                iconName: c.passed ? 'utility:success' : 'utility:error',
                iconVariant: c.passed ? 'success' : 'error'
            }));
            this.isVerified = true;

            this.statusMessage = '';
            this.isFinished = true;

        } catch (error) {
            this.statusMessage = 'Error: ' + (error.body ? error.body.message : error.message);
            console.error('Demo error:', JSON.stringify(error));
        } finally {
            this.isProcessing = false;
        }
    }

    async handleProofClick(event) {
        const index = parseInt(event.currentTarget.dataset.index, 10);
        try {
            this.proofResult = await generateProof({
                sessionId: this.sessionId,
                recordIndex: index
            });
        } catch (error) {
            console.error('Proof error:', error);
        }
    }

    async handleTamper() {
        this.isTampering = true;
        try {
            this.tamperResult = await simulateTampering({ sessionId: this.sessionId });
        } catch (error) {
            console.error('Tamper demo error:', error);
        } finally {
            this.isTampering = false;
        }
    }

    async handleRestore() {
        try {
            await restoreTamperedRecord({
                sessionId: this.sessionId,
                originalReasoning: this.tamperResult.originalReasoning
            });
            this.isRestored = true;
        } catch (error) {
            console.error('Restore error:', error);
        }
    }

    handleViewOpportunity() {
        this[NavigationMixin.Navigate]({
            type: 'standard__recordPage',
            attributes: {
                recordId: this.setupData.opportunityId,
                actionName: 'view'
            }
        });
    }

    handleReset() {
        this.isStarted = false;
        this.isProcessing = false;
        this.isSealed = false;
        this.isVerified = false;
        this.isFinished = false;
        this.sessionId = null;
        this.setupData = null;
        this.auditRecords = [];
        this.sealData = null;
        this.verifyChecks = [];
        this.proofResult = null;
        this.tamperResult = null;
        this.isTampering = false;
        this.isRestored = false;
        this.statusMessage = '';
        this.currentStage = 'Prospecting';
    }

    delay(ms) {
        return new Promise(resolve => {
            // eslint-disable-next-line @lwc/lwc/no-async-operation
            setTimeout(resolve, ms);
        });
    }
}
