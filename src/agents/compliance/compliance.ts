import { BaseAgent } from '../base-agent.js';
import { ModelTier } from '../../types/agents.js';
import type { TaskRequest, TaskResult, AgentQuery, QueryResponse, BriefingSection } from '../../types/messages.js';
import { scanContent, type FairHousingRule } from './fair-housing-rules.js';
import fs from 'fs/promises';

export class ComplianceAgent extends BaseAgent {
  private additionalRules: FairHousingRule[] = [];

  async init(): Promise<void> {
    await super.init();
    await this.loadRules();
  }

  private async loadRules(): Promise<void> {
    try {
      const raw = await fs.readFile('./config/fair-housing-rules.json', 'utf-8');
      const config = JSON.parse(raw) as { rules: { id: string; description: string; pattern: string; severity: 'warning' | 'error'; suggestion: string }[] };
      this.additionalRules = config.rules.map(r => ({
        ...r,
        pattern: new RegExp(r.pattern, 'gi'),
      }));
    } catch {
      // Use built-in rules only
    }
  }

  async handleTask(request: TaskRequest): Promise<TaskResult> {
    const start = Date.now();
    try {
      switch (request.taskType) {
        case 'content_scan':
        case 'fair_housing_check':
        case 'compliance_check': {
          const content = String(request.data['content'] ?? request.instructions);
          const result = scanContent(content, this.additionalRules);
          return this.successResult(request, {
            passed: result.passed,
            flags: result.flags,
            text: result.passed
              ? '✓ Content passed compliance scan.'
              : `⚠ Compliance issues found: ${result.flags.map(f => f.text).join(', ')}`,
          }, { processingMs: Date.now() - start });
        }

        case 'wire_fraud_warn': {
          const text = request.instructions.toLowerCase();
          const warnings: string[] = [];

          if (text.includes('wire') || text.includes('wiring funds')) {
            warnings.push('WIRE FRAUD ALERT: Always verify wire instructions via a phone call to a known number — never trust email-only instructions.');
          }
          if (text.includes('change') && (text.includes('bank') || text.includes('account'))) {
            warnings.push('SUSPICIOUS: Last-minute bank account changes are a common wire fraud tactic. Verify directly with escrow.');
          }

          return this.successResult(request, {
            warnings,
            text: warnings.length > 0 ? warnings.join('\n') : 'No wire fraud patterns detected.',
          }, { processingMs: Date.now() - start });
        }

        case 'disclosure_audit': {
          const transactionId = String(request.data['transactionId'] ?? '');
          const memResult = await this.readMemory({ path: `transactions/${transactionId}.md`, section: 'Documents' });
          const text = await this.ask(
            `Review this transaction document checklist and identify any missing required disclosures:\n\n${memResult.content}`,
            ModelTier.FAST,
          );
          return this.successResult(request, { text }, { processingMs: Date.now() - start });
        }

        case 'property_disclosure_check': {
          const yearBuilt            = request.data['yearBuilt'] as number | null ?? null;
          const hasHoa               = Boolean(request.data['hasHoa']);
          const sellerForeignPerson  = Boolean(request.data['sellerForeignPerson']);
          const state                = String(request.data['state'] ?? '');

          let disclosureRules: {
            id: string; condition: { field: string; operator: string; value: unknown };
            docType: string; name: string; isBlocking: boolean; applicableStates: string[];
          }[] = [];
          try {
            const raw = await fs.readFile('./config/disclosure-rules.json', 'utf-8');
            disclosureRules = (JSON.parse(raw) as { rules: typeof disclosureRules }).rules;
          } catch { /* use empty list */ }

          const attrs: Record<string, unknown> = { yearBuilt, hasHoa, sellerForeignPerson, state };
          const triggered = disclosureRules.filter(rule => {
            if (rule.applicableStates[0] !== 'ALL' && !rule.applicableStates.includes(state)) return false;
            const actual = attrs[rule.condition.field] ?? null;
            if (actual === null) return false;
            if (rule.condition.operator === 'eq')  return actual === rule.condition.value;
            if (rule.condition.operator === 'neq') return actual !== rule.condition.value;
            if (rule.condition.operator === 'lte') return (actual as number) <= (rule.condition.value as number);
            if (rule.condition.operator === 'gte') return (actual as number) >= (rule.condition.value as number);
            return false;
          });

          return this.successResult(request, {
            disclosures: triggered.map(r => ({ docType: r.docType, name: r.name, isBlocking: r.isBlocking })),
            count: triggered.length,
            text: triggered.length
              ? `${triggered.length} required disclosure(s): ${triggered.map(r => r.name).join(', ')}`
              : 'No special disclosures required based on property attributes.',
          }, { processingMs: Date.now() - start });
        }

        case 'heartbeat': {
          return this.successResult(request, { status: 'ready' }, { processingMs: Date.now() - start });
        }

        default: {
          const response = await this.callLlm(request.instructions, ModelTier.FAST);
          return this.successResult(request, { text: response.text }, { processingMs: Date.now() - start, llmResponse: response });
        }
      }
    } catch (err) {
      return this.failureResult(request, err as Error);
    }
  }

  async handleQuery(query: AgentQuery): Promise<QueryResponse> {
    switch (query.queryType) {
      case 'compliance_check': {
        const content = String(query.parameters['content'] ?? '');
        const result = scanContent(content, this.additionalRules);
        return this.queryResponse(query, true, { passed: result.passed, flags: result.flags });
      }

      case 'disclosure_status': {
        const transactionId = String(query.parameters['transactionId'] ?? '');
        try {
          const memResult = await this.readMemory({ path: `transactions/${transactionId}.md`, section: 'Documents' });
          return this.queryResponse(query, true, { disclosureSection: memResult.content });
        } catch {
          return this.queryResponse(query, false, { error: 'Transaction not found' });
        }
      }

      default:
        return this.queryResponse(query, false, { error: `Unknown query type: ${query.queryType}` });
    }
  }

  async contributeToBriefing(scope: string): Promise<BriefingSection> {
    if (scope === 'disclosure_deadlines_today') {
      return {
        agentId: this.id,
        title: 'Compliance Alerts',
        content: 'Checking disclosure deadlines... (CRM integration required for full data)',
        priority: 1,
      };
    }
    return {
      agentId: this.id,
      title: 'Compliance',
      content: 'No active compliance alerts.',
      priority: 3,
    };
  }
}
