import { v4 as uuidv4 } from 'uuid';
import { BaseAgent } from '../base-agent.js';
import { AGENT_CONFIGS, AgentId, ModelTier } from '../../types/agents.js';
import type { TaskRequest, TaskResult, AgentQuery, QueryResponse, BriefingSection } from '../../types/messages.js';
import type { EventType } from '../../types/events.js';
import { MemorySearch } from '../../memory/memory-search.js';

export class KnowledgeBaseAgent extends BaseAgent {
  private readonly memSearch: MemorySearch;

  constructor(...args: ConstructorParameters<typeof BaseAgent>) {
    super(...args);
    this.memSearch = new MemorySearch();
  }

  protected override async onEvent(
    eventType: EventType,
    payload: Record<string, unknown>,
  ): Promise<void> {
    switch (eventType) {
      case 'listing.status_change':
      case 'transaction.closed':
      case 'contact.created': {
        await this.writeMemory({
          path: `knowledge/events/${Date.now()}.md`,
          operation: 'create',
          content: `# Event: ${eventType}\n\n${JSON.stringify(payload, null, 2)}\n\n**Date:** ${new Date().toISOString()}`,
          writtenBy: this.id,
        }).catch(() => {});
        break;
      }
      default:
        break;
    }
  }

  async handleTask(request: TaskRequest): Promise<TaskResult> {
    const start = Date.now();
    try {
      switch (request.taskType) {
        case 'knowledge_query':
        case 'what_do_you_know': {
          const query = request.instructions;
          const results = await this.memSearch.search({
            domain: 'knowledge',
            query,
            maxResults: 5,
          });
          const text = results.matches.length > 0
            ? results.matches.map(m => `**${m.path}:** ${m.snippet}`).join('\n\n')
            : `No knowledge found for: "${query}"`;
          return this.successResult(request, { text }, { processingMs: Date.now() - start });
        }

        case 'knowledge_update':
        case 'remember_': {
          const writeResult = await this.writeMemory({
            path: `knowledge/${Date.now()}.md`,
            operation: 'create',
            content: `# Knowledge Entry\n\n${request.instructions}\n\n**Source:** ${request.data['source'] ?? 'client_input'}\n**Date:** ${new Date().toISOString()}`,
            writtenBy: this.id,
          });
          return this.successResult(request, { saved: writeResult.success, path: writeResult.path }, { processingMs: Date.now() - start });
        }

        case 'vendor_lookup': {
          const results = await this.memSearch.search({ domain: 'knowledge', query: `vendor ${request.instructions}`, maxResults: 3 });
          return this.successResult(request, { vendors: results.matches }, { processingMs: Date.now() - start });
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
      case 'knowledge_lookup': {
        const searchQuery = String(query.parameters['query'] ?? '');
        const results = await this.memSearch.search({ domain: 'knowledge', query: searchQuery, maxResults: 5 });
        return this.queryResponse(query, results.matches.length > 0, { results: results.matches });
      }

      case 'vendor_lookup': {
        const vendorType = String(query.parameters['type'] ?? '');
        const results = await this.memSearch.search({ domain: 'knowledge', query: `vendor ${vendorType}`, maxResults: 3 });
        return this.queryResponse(query, results.matches.length > 0, { vendors: results.matches });
      }

      case 'market_data': {
        const area = String(query.parameters['area'] ?? '');
        const results = await this.memSearch.search({ domain: 'knowledge', query: `market ${area}`, maxResults: 3 });
        return this.queryResponse(query, results.matches.length > 0, { data: results.matches });
      }

      default:
        return this.queryResponse(query, false, { error: `Unknown query type: ${query.queryType}` });
    }
  }

  async contributeToBriefing(scope: string): Promise<BriefingSection> {
    const results = await this.memSearch.search({ domain: 'knowledge', query: scope, maxResults: 3 });
    return {
      agentId: this.id,
      title: 'Knowledge Updates',
      content: results.matches.length > 0
        ? results.matches.map(m => `- ${m.snippet}`).join('\n')
        : 'No recent knowledge updates.',
      priority: 3,
    };
  }
}
