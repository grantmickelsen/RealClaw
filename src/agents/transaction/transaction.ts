import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import { BaseAgent } from '../base-agent.js';
import { ModelTier } from '../../types/agents.js';
import type { TaskRequest, TaskResult, AgentQuery, QueryResponse, BriefingSection } from '../../types/messages.js';
import { query as dbQuery } from '../../db/postgres.js';
import log from '../../utils/logger.js';
import { sanitize } from '../../middleware/input-sanitizer.js';

// ─── Disclosure rule shape (mirrors config/disclosure-rules.json) ──────────────

interface DisclosureCondition {
  field: string;
  operator: 'eq' | 'lte' | 'gte' | 'neq';
  value: unknown;
}

interface DisclosureRule {
  id: string;
  description: string;
  condition: DisclosureCondition;
  docType: string;
  name: string;
  isBlocking: boolean;
  applicableStates: string[];
}

interface DisclosureRulesConfig {
  rules: DisclosureRule[];
}

// ─── Milestone templates ───────────────────────────────────────────────────────

interface MilestoneTemplate {
  milestone_type: string;
  label: string;
  is_blocking: boolean;
  sequence_order: number;
  deadline_days_from_acceptance: number | null;
}

const BUYER_MILESTONES: MilestoneTemplate[] = [
  { milestone_type: 'earnest_money_due',   label: 'Earnest Money Due',        is_blocking: true,  sequence_order: 0, deadline_days_from_acceptance: 3  },
  { milestone_type: 'inspection_period',   label: 'Inspection Period',         is_blocking: true,  sequence_order: 1, deadline_days_from_acceptance: 10 },
  { milestone_type: 'inspection_removal',  label: 'Inspection Contingency Removal', is_blocking: true, sequence_order: 2, deadline_days_from_acceptance: 17 },
  { milestone_type: 'hoa_review',          label: 'HOA CC&R Review Period',    is_blocking: false, sequence_order: 3, deadline_days_from_acceptance: 3  },
  { milestone_type: 'appraisal',           label: 'Appraisal',                 is_blocking: true,  sequence_order: 4, deadline_days_from_acceptance: 21 },
  { milestone_type: 'loan_approval',       label: 'Loan Approval Contingency', is_blocking: true,  sequence_order: 5, deadline_days_from_acceptance: 21 },
  { milestone_type: 'contingency_removal', label: 'Loan Contingency Removal',  is_blocking: true,  sequence_order: 6, deadline_days_from_acceptance: 25 },
  { milestone_type: 'final_walkthrough',   label: 'Final Walkthrough',         is_blocking: false, sequence_order: 7, deadline_days_from_acceptance: null },
  { milestone_type: 'clear_to_close',      label: 'Clear to Close',            is_blocking: true,  sequence_order: 8, deadline_days_from_acceptance: null },
  { milestone_type: 'closing',             label: 'Closing',                   is_blocking: true,  sequence_order: 9, deadline_days_from_acceptance: 30 },
];

const SELLER_MILESTONES: MilestoneTemplate[] = [
  { milestone_type: 'earnest_money_due',   label: "Buyer's EMD Due",           is_blocking: false, sequence_order: 0, deadline_days_from_acceptance: 3  },
  { milestone_type: 'inspection_period',   label: "Buyer's Inspection Period", is_blocking: false, sequence_order: 1, deadline_days_from_acceptance: 10 },
  { milestone_type: 'appraisal',           label: 'Appraisal',                 is_blocking: false, sequence_order: 2, deadline_days_from_acceptance: 21 },
  { milestone_type: 'loan_approval',       label: "Buyer's Loan Approval",     is_blocking: false, sequence_order: 3, deadline_days_from_acceptance: 21 },
  { milestone_type: 'contingency_removal', label: 'All Contingencies Removed', is_blocking: true,  sequence_order: 4, deadline_days_from_acceptance: 25 },
  { milestone_type: 'final_walkthrough',   label: 'Final Walkthrough',         is_blocking: false, sequence_order: 5, deadline_days_from_acceptance: null },
  { milestone_type: 'clear_to_close',      label: 'Clear to Close',            is_blocking: true,  sequence_order: 6, deadline_days_from_acceptance: null },
  { milestone_type: 'closing',             label: 'Closing',                   is_blocking: true,  sequence_order: 7, deadline_days_from_acceptance: 30 },
];

// ─── deal_ingest extraction schema ────────────────────────────────────────────

const INGEST_SYSTEM_PROMPT = `You are a real estate transaction data extractor. Given a description of a real estate deal, extract the following fields and return ONLY valid JSON. Never invent values — use null for unknown fields.

Schema:
{
  "address": string | null,
  "dealType": "buyer" | "seller" | "dual",
  "purchasePrice": number | null,
  "earnestMoney": number | null,
  "earnestDueDays": number | null,
  "buyerName": string | null,
  "sellerName": string | null,
  "acceptanceDateIso": string | null,
  "closingDateIso": string | null,
  "escrowCompany": string | null,
  "escrowNumber": string | null,
  "inspectionDays": number | null,
  "loanContingencyDays": number | null,
  "sellerConcessions": string | null,
  "hasHoa": boolean,
  "yearBuilt": number | null,
  "sellerForeignPerson": boolean,
  "mlsNumber": string | null,
  "state": string | null
}`;

export class TransactionAgent extends BaseAgent {

  private async loadDisclosureRules(): Promise<DisclosureRule[]> {
    try {
      const raw = await fs.readFile('./config/disclosure-rules.json', 'utf-8');
      return (JSON.parse(raw) as DisclosureRulesConfig).rules;
    } catch {
      return [];
    }
  }

  private evaluateDisclosureRules(
    rules: DisclosureRule[],
    attrs: { yearBuilt: number | null; hasHoa: boolean; sellerForeignPerson: boolean; state: string | null },
  ): DisclosureRule[] {
    return rules.filter(rule => {
      if (rule.applicableStates[0] !== 'ALL' && !rule.applicableStates.includes(attrs.state ?? '')) {
        return false;
      }
      const { field, operator, value } = rule.condition;
      const actual = (attrs as Record<string, unknown>)[field] ?? null;
      if (actual === null) return false;
      if (operator === 'eq')  return actual === value;
      if (operator === 'neq') return actual !== value;
      if (operator === 'lte') return (actual as number) <= (value as number);
      if (operator === 'gte') return (actual as number) >= (value as number);
      return false;
    });
  }

  private addDays(dateStr: string, days: number): string {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0]!;
  }

  async handleTask(request: TaskRequest): Promise<TaskResult> {
    const start = Date.now();
    const tenantId = this.tenantId;

    try {
      switch (request.taskType) {

        // ─── Legacy / markdown-based capabilities ────────────────────────────

        case 'transaction_status':
        case 'where_is_document': {
          const transactionId = String(request.context.transactionId ?? request.data['transactionId'] ?? '');
          if (!transactionId) {
            return this.successResult(request, { text: 'Please provide a transaction ID or address.' }, { processingMs: Date.now() - start });
          }
          try {
            const mem = await this.readMemory({ path: `transactions/${transactionId}.md` });
            return this.successResult(request, { text: mem.content }, { processingMs: Date.now() - start });
          } catch {
            return this.successResult(request, { text: `Transaction ${transactionId} not found.` }, { processingMs: Date.now() - start });
          }
        }

        case 'timeline_manage': {
          const txId = String(request.data['transactionId'] ?? '');
          const milestone = String(request.data['milestone'] ?? request.instructions);
          await this.writeMemory({
            path: `transactions/${txId}.md`,
            operation: 'update_section',
            section: 'Milestones',
            content: `- ✓ ${milestone} — ${new Date().toISOString()}`,
            writtenBy: this.id,
          }).catch(() => {});
          this.emitEvent('transaction.milestone', { transactionId: txId, milestone });
          return this.successResult(request, { text: `Milestone recorded: ${milestone}` }, { processingMs: Date.now() - start });
        }

        case 'closing_coordinate': {
          const plan = await this.ask(
            `Create a closing coordination checklist for: ${request.instructions}\n\nInclude: document checklist, party notifications, walkthrough scheduling, key handoff plan, post-closing tasks.`,
            ModelTier.BALANCED,
          );
          this.emitEvent('transaction.closed', { details: request.instructions });
          return this.successResult(request, { text: plan }, { processingMs: Date.now() - start });
        }

        case 'post_closing': {
          const tasks = await this.ask(
            `Create a post-closing follow-up sequence for: ${request.instructions}\n\nInclude: day 1 thank you, week 1 check-in, 30-day follow-up, anniversary touchpoint, review request timing.`,
            ModelTier.BALANCED,
          );
          return this.successResult(request, { text: tasks }, { processingMs: Date.now() - start });
        }

        // ─── New: deal_ingest — extract variables from pasted contract text ──

        case 'deal_ingest': {
          const contractText = String(request.data['contractText'] ?? request.instructions);
          if (!contractText || contractText.length < 20) {
            return this.successResult(request, { text: 'Please paste the contract details or key deal terms to ingest.' }, { processingMs: Date.now() - start });
          }

          const { sanitizedText: sanitizedContract } = sanitize(contractText);
          let extracted: Record<string, unknown>;
          try {
            const raw = await this.ask(
              `${INGEST_SYSTEM_PROMPT}\n\nContract text:\n${sanitizedContract}`,
              ModelTier.BALANCED,
            );
            const jsonMatch = raw.match(/\{[\s\S]*\}/);
            extracted = JSON.parse(jsonMatch?.[0] ?? raw) as Record<string, unknown>;
          } catch (err) {
            log.warn('deal_ingest: LLM extraction failed', { err: (err as Error).message });
            return this.successResult(request, { text: 'Could not extract deal details from that text. Please include: address, price, closing date, buyer/seller names.' }, { processingMs: Date.now() - start });
          }

          const address = String(extracted['address'] ?? '');
          if (!address) {
            return this.successResult(request, { text: 'Could not identify a property address in the deal description. Please include the full address.' }, { processingMs: Date.now() - start });
          }

          // Delegate to deal_create with extracted data
          return this.handleTask({
            ...request,
            taskType: 'deal_create',
            data: { ...request.data, extracted, contractText },
          });
        }

        // ─── New: deal_create — insert deal + milestones + compliance docs ───

        case 'deal_create': {
          const extracted = (request.data['extracted'] ?? {}) as Record<string, unknown>;
          const contractText = String(request.data['contractText'] ?? '');

          const dealType    = String(extracted['dealType']    ?? 'buyer') as 'buyer' | 'seller' | 'dual';
          const address     = String(extracted['address']     ?? request.data['address'] ?? '');
          const acceptDate  = extracted['acceptanceDateIso'] as string | null ?? null;
          const closingDate = extracted['closingDateIso']    as string | null ?? null;

          const dealId = uuidv4();
          await dbQuery(
            `INSERT INTO deals
               (id, tenant_id, contact_id, deal_type, address, mls_number,
                purchase_price, earnest_money, earnest_due_date,
                buyer_name, seller_name, escrow_company, escrow_number,
                acceptance_date, closing_date, year_built, has_hoa,
                seller_foreign_person, seller_concessions, stage, raw_contract_text)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'mutual_acceptance',$20)`,
            [
              dealId, tenantId,
              request.data['contactId'] ?? null,
              dealType, address,
              extracted['mlsNumber'] ?? null,
              extracted['purchasePrice'] ?? null,
              extracted['earnestMoney'] ?? null,
              acceptDate && extracted['earnestDueDays']
                ? this.addDays(acceptDate, Number(extracted['earnestDueDays']))
                : null,
              extracted['buyerName'] ?? null,
              extracted['sellerName'] ?? null,
              extracted['escrowCompany'] ?? null,
              extracted['escrowNumber'] ?? null,
              acceptDate,
              closingDate,
              extracted['yearBuilt'] ?? null,
              extracted['hasHoa'] ?? false,
              extracted['sellerForeignPerson'] ?? false,
              extracted['sellerConcessions'] ?? null,
              contractText || null,
            ],
          );

          // Seed milestones
          const templates = dealType === 'seller' ? SELLER_MILESTONES : BUYER_MILESTONES;
          for (const tmpl of templates) {
            const deadline = acceptDate && tmpl.deadline_days_from_acceptance !== null
              ? this.addDays(acceptDate, tmpl.deadline_days_from_acceptance)
              : null;
            await dbQuery(
              `INSERT INTO deal_milestones
                 (id, deal_id, milestone_type, label, is_blocking, sequence_order, deadline)
               VALUES ($1,$2,$3,$4,$5,$6,$7)`,
              [uuidv4(), dealId, tmpl.milestone_type, tmpl.label, tmpl.is_blocking, tmpl.sequence_order, deadline],
            );
          }

          // Evaluate compliance rules and insert deal_documents
          const rules = await this.loadDisclosureRules();
          const triggered = this.evaluateDisclosureRules(rules, {
            yearBuilt: extracted['yearBuilt'] as number | null ?? null,
            hasHoa: Boolean(extracted['hasHoa']),
            sellerForeignPerson: Boolean(extracted['sellerForeignPerson']),
            state: extracted['state'] as string | null ?? null,
          });
          for (const rule of triggered) {
            await dbQuery(
              `INSERT INTO deal_documents (id, deal_id, doc_type, name, is_blocking) VALUES ($1,$2,$3,$4,$5)`,
              [uuidv4(), dealId, rule.docType, rule.name, rule.isBlocking],
            );
          }

          // Write markdown context for the agent workspace
          await this.writeMemory({
            path: `transactions/${dealId}.md`,
            operation: 'create',
            content: `# Transaction: ${address}\n\n## Parties\n- **Buyer:** ${extracted['buyerName'] ?? 'TBD'}\n- **Seller:** ${extracted['sellerName'] ?? 'TBD'}\n- **Escrow:** ${extracted['escrowCompany'] ?? 'TBD'}\n\n## Timeline\n- **Acceptance Date:** ${acceptDate ?? 'TBD'}\n- **Closing Date:** ${closingDate ?? 'TBD'}\n\n## Milestones\n${templates.map(t => `- [ ] ${t.label}`).join('\n')}\n\n## Documents\n${triggered.map(r => `- [ ] ${r.name}`).join('\n') || '- No special disclosures triggered'}\n\n## Notes\n`,
            writtenBy: this.id,
          }).catch(() => {});

          this.emitEvent('transaction.started', { dealId, address, tenantId });
          this.pushWsEvent('DEAL_INGEST_READY', dealId, {
            dealId,
            address,
            complianceCount: triggered.length,
          });

          return this.successResult(request, {
            text: `Deal created for **${address}**.\n- ${templates.length} milestones seeded\n- ${triggered.length} compliance disclosure(s) required${triggered.length ? ': ' + triggered.map(r => r.name).join(', ') : ''}`,
            dealId,
          }, { processingMs: Date.now() - start });
        }

        // ─── New: deal_list ──────────────────────────────────────────────────

        case 'deal_list': {
          const rows = await dbQuery<{
            id: string; address: string; stage: string; closing_date: string | null;
            purchase_price: string | null; buyer_name: string | null; seller_name: string | null;
            deal_type: string;
          }>(
            `SELECT d.id, d.address, d.stage, d.closing_date, d.purchase_price,
                    d.buyer_name, d.seller_name, d.deal_type
             FROM deals d
             WHERE d.tenant_id = $1 AND d.status = 'active'
             ORDER BY d.closing_date ASC NULLS LAST`,
            [tenantId],
          );
          return this.successResult(request, { deals: rows.rows, count: rows.rowCount }, { processingMs: Date.now() - start });
        }

        // ─── New: deal_status ────────────────────────────────────────────────

        case 'deal_status': {
          const dealId = String(request.data['dealId'] ?? '');
          if (!dealId) {
            return this.successResult(request, { text: 'dealId required' }, { processingMs: Date.now() - start });
          }
          // Verify ownership before fetching related tables
          const dealOwnership = await dbQuery<Record<string, unknown>>(
            'SELECT * FROM deals WHERE id = $1 AND tenant_id = $2',
            [dealId, tenantId],
          );
          if (!dealOwnership.rows[0]) {
            return this.successResult(request, { deal: null, milestones: [], documents: [], alerts: [] }, { processingMs: Date.now() - start });
          }
          const [milestones, documents, alerts] = await Promise.all([
            dbQuery<Record<string, unknown>>('SELECT * FROM deal_milestones WHERE deal_id = $1 ORDER BY sequence_order', [dealId]),
            dbQuery<Record<string, unknown>>('SELECT * FROM deal_documents WHERE deal_id = $1 ORDER BY is_blocking DESC', [dealId]),
            dbQuery<Record<string, unknown>>('SELECT * FROM deal_alerts WHERE deal_id = $1 AND dismissed_at IS NULL ORDER BY priority, created_at DESC', [dealId]),
          ]);
          return this.successResult(request, {
            deal: dealOwnership.rows[0],
            milestones: milestones.rows,
            documents: documents.rows,
            alerts: alerts.rows,
          }, { processingMs: Date.now() - start });
        }

        case 'heartbeat': {
          const { rowCount } = await dbQuery(
            `SELECT 1 FROM deals WHERE tenant_id = $1 AND status = 'active' LIMIT 1`,
            [tenantId],
          ).catch(() => ({ rowCount: 0 }));
          return this.successResult(request, { status: 'ready', openDeals: rowCount ?? 0 }, { processingMs: Date.now() - start });
        }

        default: {
          const response = await this.callLlm(request.instructions, ModelTier.BALANCED);
          return this.successResult(request, { text: response.text }, { processingMs: Date.now() - start, llmResponse: response });
        }
      }
    } catch (err) {
      return this.failureResult(request, err as Error);
    }
  }

  async handleQuery(query: AgentQuery): Promise<QueryResponse> {
    if (query.queryType === 'transaction_status') {
      const id = String(query.parameters['dealId'] ?? query.parameters['transactionId'] ?? '');
      try {
        const res = await dbQuery<{ address: string; stage: string; closing_date: string | null }>(
          'SELECT address, stage, closing_date FROM deals WHERE id = $1 AND tenant_id = $2',
          [id, this.tenantId],
        );
        if (res.rows[0]) {
          return this.queryResponse(query, true, res.rows[0]);
        }
        const mem = await this.readMemory({ path: `transactions/${id}.md` });
        return this.queryResponse(query, true, { status: mem.content });
      } catch {
        return this.queryResponse(query, false, { error: 'Transaction not found' });
      }
    }
    return this.queryResponse(query, false, { error: `Unknown query: ${query.queryType}` });
  }

  async contributeToBriefing(scope: string): Promise<BriefingSection> {
    try {
      const tenantId = scope;
      const res = await dbQuery<{ address: string; stage: string; closing_date: string | null }>(
        `SELECT address, stage, closing_date FROM deals WHERE tenant_id = $1 AND status = 'active' ORDER BY closing_date ASC NULLS LAST LIMIT 5`,
        [tenantId],
      );
      if (!res.rows.length) {
        return {
          agentId: this.id,
          title: 'Active Transactions',
          content: 'No active transactions. Paste a ratified contract into chat to create a deal.',
          priority: 2,
        };
      }
      const lines = res.rows.map(r => `- **${r.address}** — ${r.stage} (closes ${r.closing_date ?? 'TBD'})`).join('\n');
      return { agentId: this.id, title: 'Active Transactions', content: lines, priority: 1 };
    } catch {
      return { agentId: this.id, title: 'Active Transactions', content: 'No active transactions.', priority: 2 };
    }
  }

}
