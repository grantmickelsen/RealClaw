import { v4 as uuidv4 } from 'uuid';
import { BaseAgent } from '../base-agent.js';
import { AgentId, ModelTier } from '../../types/agents.js';
import type { TaskRequest, TaskResult, AgentQuery, QueryResponse, BriefingSection } from '../../types/messages.js';

export class CommsAgent extends BaseAgent {
  async handleTask(request: TaskRequest): Promise<TaskResult> {
    const start = Date.now();
    const toneModel = await this.getToneModel();
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

          const dm = await this.ask(
            `Draft a professional LinkedIn DM for: ${request.instructions}\n\nContact context:\n${contextData}\n\nTone guide:\n${toneModel}\n\nMax 300 chars.`,
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
            `Draft a formal business letter for: ${request.instructions}\n\nFormat: Dear [Name],\n[Body]\n\nSincerely,\n[Agent Name]\nReal Estate Professional\n\nTone guide:\n${toneModel}`,
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

        case 'sms_suggest': {
          const profile = String(request.data['contactProfile'] ?? '');
          const recentMessages = String(request.data['recentMessages'] ?? '');
          const previous = String(request.data['previousSuggestions'] ?? '');
          const previousHint = previous ? `\n\nDo NOT repeat these suggestions:\n${previous}` : '';
          const raw = await this.ask(
            `You are drafting SMS reply suggestions for a real estate agent. Be concise (under 120 chars each), conversational, and true to the agent's voice.

Contact profile: ${profile || 'No profile available'}

Recent conversation (newest last):
${recentMessages || 'No messages yet'}

Generate exactly 3 distinct reply options:
1. A direct follow-up on their most recent message or question
2. An action CTA (schedule showing, send listing, request call)
3. A warm nurture reply (lower-pressure, relationship-building)${previousHint}

Tone guide (match this voice, adapted for SMS brevity):
${toneModel}

Return ONLY a JSON array of 3 strings. Example: ["Reply 1", "Reply 2", "Reply 3"]`,
            ModelTier.FAST,
          );
          let suggestions: string[] = [];
          try {
            const match = raw.match(/\[[\s\S]*\]/);
            if (match) suggestions = JSON.parse(match[0]) as string[];
          } catch { /* fall through — return empty */ }
          return this.successResult(request, { suggestions }, { processingMs: Date.now() - start });
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

          const draft = await this.ask(
            `${request.instructions}\n\nTone guide:\n${toneModel}`,
            ModelTier.BALANCED,
          );
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

        case 'email_ingest': {
          const fromAddress  = String(request.data['fromAddress']  ?? '');
          const fromName     = String(request.data['fromName']     ?? '');
          const subject      = String(request.data['subject']      ?? '');
          const bodyText     = String(request.data['bodyText']     ?? '');
          const contactId    = request.context.contactId ?? null;
          const inboundId    = String(request.data['inboundEmailId'] ?? '');

          const raw = await this.ask(
            `You are analyzing an inbound email to a real estate agent. Extract structured lead intelligence.

From: ${fromName ? `${fromName} <${fromAddress}>` : fromAddress}
Subject: ${subject}
Body (first 2000 chars):
${bodyText}

${contactId ? `This sender is already in the agent’s contacts (id: ${contactId}).` : "This sender is NOT yet in the agent’s contacts."}

Return a JSON object with these fields:
- senderIntent: "buying" | "selling" | "info" | "referral" | "vendor" | "other"
- urgencyScore: 1-10 (10 = most urgent; 8+ means create a briefing card)
- leadInfo: { name: string|null, phone: string|null, budget: string|null, timeline: string|null, propertyInterest: string|null }
- suggestedAction: "call" | "sms" | "email_reply" | "schedule_showing" | "ignore"
- draftReply: string (2-3 sentence reply ready for agent review; address sender by first name if known; match the tone guide below)

Tone guide for draftReply:
${toneModel}

Return ONLY the JSON object.`,
            ModelTier.BALANCED,
          );

          let extracted: Record<string, unknown> = {};
          try {
            const match = raw.match(/\{[\s\S]*\}/);
            if (match) extracted = JSON.parse(match[0]) as Record<string, unknown>;
          } catch { /* best-effort */ }

          const urgencyScore = Math.min(10, Math.max(1, Number(extracted['urgencyScore'] ?? 3)));

          // Side effect: update the inbound_emails row with extracted data
          const sideEffects = inboundId ? [{
            targetAgent: this.id,
            action: 'update_inbound_email',
            data: { inboundEmailId: inboundId, extractedData: extracted },
          }] : [];

          return this.successResult(request, {
            extracted,
            text: `Email from ${fromName || fromAddress} classified as ${String(extracted['senderIntent'] ?? 'unknown')} (urgency ${urgencyScore}/10).`,
          }, {
            resultType: 'structured_data',
            processingMs: Date.now() - start,
            // High-urgency lead emails surface as a briefing card
            ...(urgencyScore >= 7 ? {
              approval: {
                actionType: 'send_email',
                preview: String(extracted['draftReply'] ?? '').slice(0, 200),
                recipients: [fromAddress],
                medium: 'email' as const,
                fullContent: String(extracted['draftReply'] ?? ''),
              },
            } : {}),
          });
        }

        case 'heartbeat': {
          return this.successResult(request, { status: 'ready' }, { processingMs: Date.now() - start });
        }

        default: {
          const response = await this.callLlm(
            `${request.instructions}\n\nTone guide:\n${toneModel}`,
            ModelTier.BALANCED,
          );
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
    const sections: string[] = [];

    // Structured preferences from onboarding (salutation, formality, emoji, writing sample)
    try {
      const prefs = await this.readMemory({ path: 'client-profile/tone-prefs.md' });
      if (prefs.content.trim()) sections.push(prefs.content.trim());
    } catch { /* not yet set */ }

    // LLM-analyzed style model extracted from sent emails
    try {
      const analyzed = await this.readMemory({ path: 'client-profile/tone-model.md' });
      if (analyzed.content.trim()) sections.push(`## Style Analysis (from sent emails)\n\n${analyzed.content.trim()}`);
    } catch { /* not yet analyzed */ }

    return sections.length > 0
      ? sections.join('\n\n---\n\n')
      : 'Professional, warm, first-name basis. Concise sentences.';
  }
}
