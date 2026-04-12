import { v4 as uuidv4 } from 'uuid';
import { BaseAgent } from '../base-agent.js';
import { AgentId, ModelTier } from '../../types/agents.js';
import type { TaskRequest, TaskResult, AgentQuery, QueryResponse, BriefingSection } from '../../types/messages.js';

export class CommsAgent extends BaseAgent {
  async handleTask(request: TaskRequest): Promise<TaskResult> {
    const start = Date.now();
    try {
      switch (request.taskType) {
        case 'email_draft':
        case 'draft_email':
        case 'reply_to': {
          const contactId = request.context.contactId ?? 'unknown';
          const contextData = await this.getContactContext(contactId);
          const complianceOk = await this.checkCompliance(request.instructions);

          if (!complianceOk.passed) {
            return this.successResult(request, {
              text: `⚠ Compliance issues detected before drafting:\n${complianceOk.flags.join('\n')}`,
            }, { processingMs: Date.now() - start });
          }

          const toneModel = await this.getToneModel();
          const draft = await this.ask(
            `Draft a professional email for the following request:\n\n${request.instructions}\n\nContact context:\n${contextData}\n\nTone guide:\n${toneModel}`,
            ModelTier.BALANCED,
          );

          return this.successResult(request, {
            draft,
            text: `Email draft ready for your review.`,
          }, {
            resultType: 'draft',
            approval: {
              actionType: 'send_email',
              preview: draft.slice(0, 200) + (draft.length > 200 ? '...' : ''),
              recipients: [contactId],
              medium: 'email',
              fullContent: draft,
            },
            processingMs: Date.now() - start,
          });
        }

        case 'email_triage': {
          const inbox = String(request.data['emailsJson'] ?? '[]');
          const result = await this.ask(
            `Triage these emails and categorize as urgent/response-needed/fyi/junk. Return a JSON array with: {messageId, category, summary, suggestedAction}.\n\nEmails:\n${inbox}`,
            ModelTier.FAST,
          );
          return this.successResult(request, { triage: result }, { processingMs: Date.now() - start });
        }

        case 'linkedin_dm': {
          const contactId = request.context.contactId ?? 'unknown';
          const contextData = await this.getContactContext(contactId);
          const complianceOk = await this.checkCompliance(request.instructions);

          if (!complianceOk.passed) {
            return this.successResult(request, {
              text: `⚠ Compliance issues detected before LinkedIn DM:\n${complianceOk.flags.join('\n')}`,
            }, { processingMs: Date.now() - start });
          }

          const toneModel = await this.getToneModel();
          const dm = await this.ask(
            `Draft a professional LinkedIn DM for: ${request.instructions}\n\nContact context:\n${contextData}\n\nTone:\n${toneModel}\n\nMax 300 chars.`,
            ModelTier.BALANCED,
          );

          return this.successResult(request, { text: dm }, {
            approval: {
              actionType: 'send_linkedin_dm',
              preview: dm,
              recipients: [contactId],
              medium: 'linkedin_dm',
              fullContent: dm,
            },
            processingMs: Date.now() - start,
          });
        }

        case 'letter_draft': {
          const formal = await this.ask(
            `Draft a formal business letter for: ${request.instructions}\n\nFormat: Dear [Name],\n[Body]\n\nSincerely,\nGrant Mickelsen\nReal Estate Professional`,
            ModelTier.BALANCED,
          );
          return this.successResult(request, { text: formal }, {
            approval: {
              actionType: 'send_email',
              preview: formal.slice(0, 200),
              recipients: [],
              medium: 'email',
              fullContent: formal,
            },
            processingMs: Date.now() - start,
          });
        }

        case 'send_message':
        case 'sms_send': {
          const medium = String(request.data['medium'] ?? 'email');
          const isApprovedExecution = request.data['approved'] === true;

          if (isApprovedExecution) {
            const content = String(request.instructions ?? '').trim();
            this.emitEvent('email.sent', {
              correlationId: request.correlationId,
              contactId: request.context.contactId,
              medium,
              recipients: request.data['recipients'],
            });
            return this.successResult(request, {
              sent: true,
              medium,
              content,
              text: `${medium.toUpperCase()} sent.`,
            }, {
              processingMs: Date.now() - start,
            });
          }

          const draft = await this.ask(request.instructions, ModelTier.BALANCED);
          return this.successResult(request, { draft }, {
            resultType: 'draft',
            approval: {
              actionType: medium === 'sms' ? 'send_sms' : 'send_email',
              preview: draft.slice(0, 200),
              recipients: [request.context.contactId ?? 'unknown'],
              medium: medium as 'email' | 'sms' | 'linkedin_dm',
              fullContent: draft,
            },
            processingMs: Date.now() - start,
          });
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
    return this.queryResponse(query, false, { error: 'Comms agent does not support queries' });
  }

  async contributeToBriefing(scope: string): Promise<BriefingSection> {
    return {
      agentId: this.id,
      title: 'Inbox Summary',
      content: 'Email triage requires Gmail integration. Connect Gmail to see inbox status.',
      priority: 2,
    };
  }

  private async getContactContext(contactId: string): Promise<string> {
    try {
      const query: AgentQuery = {
        messageId: uuidv4(),
        timestamp: new Date().toISOString(),
        correlationId: uuidv4(),
        type: 'AGENT_QUERY',
        fromAgent: this.id,
        toAgent: AgentId.RELATIONSHIP,
        queryType: 'contact_memory',
        parameters: { contactId },
        urgency: 'blocking',
      };
      const response = await this.queryAgent(AgentId.RELATIONSHIP, query);
      return response.found ? String(response.data['profile'] ?? '') : '';
    } catch {
      return '';
    }
  }

  private async checkCompliance(content: string): Promise<{ passed: boolean; flags: string[] }> {
    try {
      const query: AgentQuery = {
        messageId: uuidv4(),
        timestamp: new Date().toISOString(),
        correlationId: uuidv4(),
        type: 'AGENT_QUERY',
        fromAgent: this.id,
        toAgent: AgentId.COMPLIANCE,
        queryType: 'compliance_check',
        parameters: { content },
        urgency: 'blocking',
      };
      const response = await this.queryAgent(AgentId.COMPLIANCE, query);
      const flags = (response.data['flags'] as { text: string }[] | undefined) ?? [];
      return {
        passed: response.data['passed'] as boolean ?? true,
        flags: flags.map(f => f.text),
      };
    } catch {
      return { passed: true, flags: [] };
    }
  }

  private async getToneModel(): Promise<string> {
    try {
      const mem = await this.readMemory({ path: 'client-profile/tone-model.md' });
      return mem.content;
    } catch {
      return 'Professional, warm, first-name basis. Concise sentences.';
    }
  }
}
