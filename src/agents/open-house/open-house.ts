import { BaseAgent } from '../base-agent.js';
import { ModelTier } from '../../types/agents.js';
import type { TaskRequest, TaskResult, AgentQuery, QueryResponse, BriefingSection } from '../../types/messages.js';

export class OpenHouseAgent extends BaseAgent {
  async handleTask(request: TaskRequest): Promise<TaskResult> {
    const start = Date.now();
    try {
      switch (request.taskType) {
        case 'plan_open_house': {
          const listing = String(request.data['listing'] ?? request.instructions);
          const plan = await this.ask(
            `Create a comprehensive open house plan for: ${listing}\n\nInclude: marketing checklist, staging tips, sign placement, visitor flow, materials list, follow-up sequence.`,
            ModelTier.BALANCED,
          );
          return this.successResult(request, { text: plan }, { processingMs: Date.now() - start });
        }

        case 'process_signins': {
          const signinData = String(request.data['signins'] ?? request.instructions);
          const processed = await this.ask(
            `Process these open house sign-ins. For each attendee, assess: buyer readiness, interest level, follow-up priority.\n\nSign-ins:\n${signinData}`,
            ModelTier.BALANCED,
          );

          // Emit event for each sign-in
          let signins: { name: string; email: string }[] = [];
          try {
            signins = JSON.parse(signinData || '[]') as { name: string; email: string }[];
          } catch {
            // Invalid JSON — no sign-ins to process
          }
          for (const signin of signins) {
            this.emitEvent('open_house.signup', {
              name: signin.name,
              email: signin.email,
              listing: request.context.listingId,
            });
          }

          return this.successResult(request, { text: processed, signinsProcessed: signins.length }, { processingMs: Date.now() - start });
        }

        case 'feedback_compile': {
          const feedbackData = String(request.data['feedback'] ?? request.instructions);
          const report = await this.ask(
            `Compile this open house feedback into a professional seller report. Be factual, constructive, and strategic.\n\nFeedback:\n${feedbackData}`,
            ModelTier.BALANCED,
          );
          return this.successResult(request, { text: report }, { processingMs: Date.now() - start });
        }

        case 'heartbeat': {
          return this.successResult(request, { status: 'ready' }, { processingMs: Date.now() - start });
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
    return this.queryResponse(query, false, { error: 'Open House agent does not support queries' });
  }

  async contributeToBriefing(scope: string): Promise<BriefingSection> {
    return {
      agentId: this.id,
      title: 'Open Houses',
      content: 'No open houses scheduled. Plan one with "plan open house for [address]".',
      priority: 3,
    };
  }
}
