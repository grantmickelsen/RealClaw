import { BaseAgent } from '../base-agent.js';
import { ModelTier } from '../../types/agents.js';
import type { TaskRequest, TaskResult, AgentQuery, QueryResponse, BriefingSection } from '../../types/messages.js';

export class TransactionAgent extends BaseAgent {
  async handleTask(request: TaskRequest): Promise<TaskResult> {
    const start = Date.now();
    try {
      switch (request.taskType) {
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
            return this.successResult(request, { text: `Transaction ${transactionId} not found. Has it been created in the system?` }, { processingMs: Date.now() - start });
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

        case 'heartbeat': {
          return this.successResult(request, { status: 'ready', openTransactions: 0 }, { processingMs: Date.now() - start });
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
      const transactionId = String(query.parameters['transactionId'] ?? '');
      try {
        const mem = await this.readMemory({ path: `transactions/${transactionId}.md` });
        return this.queryResponse(query, true, { status: mem.content });
      } catch {
        return this.queryResponse(query, false, { error: 'Transaction not found' });
      }
    }
    return this.queryResponse(query, false, { error: `Unknown query: ${query.queryType}` });
  }

  async contributeToBriefing(scope: string): Promise<BriefingSection> {
    return {
      agentId: this.id,
      title: 'Active Transactions',
      content: 'No active transactions in system. Create transactions via "new transaction [address]".',
      priority: 2,
    };
  }
}
