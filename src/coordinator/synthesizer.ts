import type { AgentId } from '../types/agents.js';
import { ModelTier } from '../types/agents.js';
import type { TaskResult, InboundMessage, ApprovalItem } from '../types/messages.js';
import type { LlmRouter } from '../llm/router.js';

const SYNTHESIS_PROMPT = `You are the synthesizer for a real estate executive assistant named Claw.
Your job is to merge multiple agent results into a single coherent, concise response for the agent's client.
Be professional, brief, and action-oriented. Do not list raw data — summarize and prioritize.
If there are pending approvals, mention them briefly at the end.`;

export class Synthesizer {
  constructor(
    private readonly llmRouter: LlmRouter,
    private readonly agentId: AgentId,
  ) {}

  async synthesize(
    results: TaskResult[],
    originalMessage: InboundMessage,
    onToken?: (token: string) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    if (results.length === 0) {
      return "I'm working on that. I'll update you shortly.";
    }

    if (results.length === 1) {
      const result = results[0]!;
      if (result.status === 'failed') {
        return this.formatFailure(result);
      }
      return this.extractText(result);
    }

    // Multiple results — synthesize with LLM (streaming if onToken provided)
    const summaries = results
      .map((r, _i) => `Agent ${r.fromAgent} (${r.status}): ${this.extractText(r)}`)
      .join('\n\n');

    const prompt = `Original request: "${originalMessage.content.text}"

Agent results:
${summaries}

Synthesize a single, concise response.`;

    try {
      const response = await this.llmRouter.complete(
        {
          model: ModelTier.FAST,
          systemPrompt: SYNTHESIS_PROMPT,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.5,
          maxOutputTokens: 1024,
          onToken,
          signal,
          correlationId: originalMessage.correlationId,
        },
        this.agentId,
      );
      return response.text;
    } catch {
      // Fallback: concatenate the text results
      return results
        .filter(r => r.status !== 'failed')
        .map(r => this.extractText(r))
        .filter(Boolean)
        .join('\n\n');
    }
  }

  extractPendingApprovals(results: TaskResult[]): ApprovalItem[] {
    const items: ApprovalItem[] = [];
    let index = 0;

    for (const result of results) {
      if (result.status === 'needs_approval' && result.approval) {
        items.push({
          index: index++,
          actionType: result.approval.actionType,
          preview: result.approval.preview,
          fullContent: result.approval.fullContent,
          medium: result.approval.medium ?? 'email',
          recipients: result.approval.recipients,
          originatingAgent: result.fromAgent,
          taskResultId: result.messageId,
        });
      }
    }

    return items;
  }

  private extractText(result: TaskResult): string {
    if (typeof result.result['text'] === 'string') return result.result['text'];
    if (typeof result.result['summary'] === 'string') return result.result['summary'];
    if (typeof result.result['message'] === 'string') return result.result['message'];
    if (typeof result.result['content'] === 'string') return result.result['content'];
    if (typeof result.result['draft'] === 'string') return result.result['draft'];
    return JSON.stringify(result.result);
  }

  private formatFailure(result: TaskResult): string {
    const error = result.result['error'] as string | undefined;
    return `I encountered an issue processing that request${error ? ': ' + error : ''}. Please try again or rephrase your request.`;
  }
}
