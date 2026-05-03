import { v4 as uuidv4 } from 'uuid';
import { BaseAgent } from '../base-agent.js';
import { ModelTier, AgentId, Priority } from '../../types/agents.js';
import type { TaskRequest, TaskResult, AgentQuery, QueryResponse, BriefingSection } from '../../types/messages.js';
import { MemorySearch } from '../../memory/memory-search.js';
import type { EventType } from '../../types/events.js';

export class RelationshipAgent extends BaseAgent {
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
      case 'email.sent':
      case 'calendar.event_added':
        await this.updateContactInteraction(payload);
        break;
      case 'transaction.closed':
        await this.markPastClient(payload);
        break;
      case 'open_house.signup':
        await this.processOpenHouseSignup(payload);
        break;
    }
  }

  async handleTask(request: TaskRequest): Promise<TaskResult> {
    const start = Date.now();
    try {
      switch (request.taskType) {
        case 'who_is':
        case 'contact_memory': {
          const name = request.instructions.replace(/who is/gi, '').trim();
          const results = await this.memSearch.search({ domain: 'contacts', query: name, maxResults: 3 });
          if (results.matches.length === 0) {
            return this.successResult(request, { text: `No contact found matching "${name}"` }, { processingMs: Date.now() - start });
          }
          const topMatch = results.matches[0]!;
          const memResult = await this.readMemory({ path: topMatch.path });
          return this.successResult(request, { text: memResult.content, contactPath: topMatch.path }, { processingMs: Date.now() - start });
        }

        case 'contact_dossier': {
          const contactId = String(request.data['contactId'] ?? '');
          if (!contactId) return this.failureResult(request, new Error('contactId required'));

          const profileMem = await this.readMemory({ path: `contacts/${contactId}.md` });
          const profileContent = profileMem.content || 'No profile found.';

          const prompt = `You are a real estate CRM assistant. Based on this contact profile, produce:
1. A 2-3 sentence narrative paragraph summarizing who this person is, what they want, and the most recent relevant interaction. Write in second person ("They are looking for..."). Be specific — use exact figures, names, preferences from the profile.
2. Exactly 2-3 suggested next actions.

Profile:
${profileContent}

Return ONLY valid JSON with no markdown or code fences:
{
  "narrative": "string",
  "suggestedActions": [
    { "label": "string", "actionType": "send_sms|send_email|modify_calendar", "preview": "string" }
  ]
}`;

          const response = await this.callLlm(prompt, ModelTier.BALANCED);
          let parsed: { narrative: string; suggestedActions: Array<{ label: string; actionType: string; preview: string }> };
          try {
            const jsonMatch = response.text.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error('no JSON found');
            parsed = JSON.parse(jsonMatch[0]) as typeof parsed;
          } catch {
            return this.failureResult(request, new Error('Narrative parse failed'));
          }
          return this.successResult(
            request,
            { text: JSON.stringify(parsed), narrative: parsed.narrative, suggestedActions: parsed.suggestedActions },
            { processingMs: Date.now() - start },
          );
        }

        case 'lead_status': {
          const name = request.instructions;
          const results = await this.memSearch.search({ domain: 'contacts', query: name, maxResults: 1 });
          if (!results.matches[0]) {
            return this.successResult(request, { text: 'Contact not found' }, { processingMs: Date.now() - start });
          }
          const memResult = await this.readMemory({ path: results.matches[0].path });
          const score = await this.scoreLead(memResult.content);
          return this.successResult(request, { text: `Lead score for ${name}: ${score}/100`, score }, { processingMs: Date.now() - start });
        }

        case 'update_contact': {
          const contactId = String(request.context.contactId ?? '');
          if (!contactId) return this.failureResult(request, new Error('contactId required'));
          const writeResult = await this.writeMemory({
            path: `contacts/${contactId}.md`,
            operation: 'append',
            content: request.instructions,
            writtenBy: this.id,
          });
          if (writeResult.success) {
            this.emitEvent('contact.updated', { contactId });
          }
          return this.successResult(request, { updated: writeResult.success }, { processingMs: Date.now() - start });
        }

        case 'lead_decay':
        case 'sphere_nurture': {
          const staleContacts = await this.findStaleContacts(14);
          const text = staleContacts.length > 0
            ? `Found ${staleContacts.length} contacts with no activity in 14+ days:\n${staleContacts.join('\n')}`
            : 'All contacts have been engaged within 14 days. Great sphere management!';
          return this.successResult(request, { text, staleContacts }, { processingMs: Date.now() - start });
        }

        case 'sentiment_analysis': {
          const content = String(request.data['content'] ?? request.instructions);
          const analysisRaw = await this.ask(
            `Classify sentiment of this message for real estate context:
Content: ${content}

Return JSON:
{
  "sentiment": "positive"|"neutral"|"negative"|"urgent",
  "confidence": 0.0-1.0,
  "summary": "1 sentence explanation"
}`, ModelTier.FAST
          );
          let parsed;
          try {
            const jsonMatch = analysisRaw.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error('no JSON found');
            parsed = JSON.parse(jsonMatch[0]);
          } catch {
            parsed = { sentiment: 'neutral' as const, confidence: 0, summary: 'Unable to analyze' };
          }
          if (parsed.sentiment === 'negative' || parsed.sentiment === 'urgent') {
            this.emitEvent('contact.sentiment_flag', { 
              contactId: request.context.contactId, 
              sentiment: parsed,
              content 
            });
          }
          return this.successResult(request, parsed, { processingMs: Date.now() - start });
        }

        case 'pipeline_tracking': {
          const results = await this.memSearch.search({ domain: 'contacts', query: 'Stage:', maxResults: 50 });
          const grouped: Record<string, string[]> = {};
          for (const match of results.matches) {
            const mem = await this.readMemory({ path: match.path, section: 'Overview' });
            const stageMatch = mem.content.match(/Stage:\s*([^\n]+)/i);
            const stage = stageMatch?.[1]?.trim() ?? 'Unknown';
            grouped[stage] = grouped[stage] ?? [];
            grouped[stage].push(match.path);
          }
          return this.successResult(request, { pipeline: grouped }, { processingMs: Date.now() - start });
        }

        case 'contact_enrichment': {
          const contactId = String(request.context.contactId ?? '');
          const profile = await this.readMemory({ path: `contacts/${contactId}.md` });
          const kbResults = await this.memSearch.search({ domain: 'knowledge', query: profile.content.slice(0, 100), maxResults: 5 });
          const additions = kbResults.matches.slice(0, 3).map(m => m.snippet).join('\n');
          await this.writeMemory({
            path: `contacts/${contactId}.md`,
            operation: 'append',
            content: `\n## Enrichment\n${additions}`,
            writtenBy: this.id,
          });
          return this.successResult(request, { enriched: true, additions }, { processingMs: Date.now() - start });
        }

        case 'follow_up_with': {
          const name = String(request.data['contactName'] ?? request.instructions);
          const results = await this.memSearch.search({ domain: 'contacts', query: name, maxResults: 1 });
          const contactData = results.matches[0]
            ? await this.readMemory({ path: results.matches[0].path })
            : null;
          return this.successResult(request, {
            contactFound: !!contactData,
            contactId: request.context.contactId,
            contactData: contactData?.content,
          }, { processingMs: Date.now() - start });
        }

        case 'heartbeat': {
          const stale = await this.findStaleContacts(Number(request.data['decayThresholdDays'] ?? 14));
          if (stale.length > 0) {
            this.emitEvent('lead.decay_detected', { contacts: stale });
          }
          return this.successResult(request, { staleCount: stale.length }, { processingMs: Date.now() - start });
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
    switch (query.queryType) {
      case 'contact_memory': {
        const contactId = String(query.parameters['contactId'] ?? '');
        const name = String(query.parameters['name'] ?? contactId);
        try {
          const results = await this.memSearch.search({ domain: 'contacts', query: name, maxResults: 1 });
          if (!results.matches[0]) return this.queryResponse(query, false, {});
          const mem = await this.readMemory({ path: results.matches[0].path });
          return this.queryResponse(query, true, { profile: mem.content });
        } catch {
          return this.queryResponse(query, false, {});
        }
      }

      case 'contact_preferences': {
        const contactId = String(query.parameters['contactId'] ?? '');
        try {
          const mem = await this.readMemory({ path: `contacts/${contactId}.md`, section: 'communication_preferences' });
          return this.queryResponse(query, !!mem.content, { preferences: mem.content });
        } catch {
          return this.queryResponse(query, false, {});
        }
      }

      case 'contact_match': {
        const name = String(query.parameters['name'] ?? '');
        const results = await this.memSearch.search({ domain: 'contacts', query: name, maxResults: 3 });
        return this.queryResponse(query, results.matches.length > 0, { matches: results.matches });
      }

      default:
        return this.queryResponse(query, false, { error: `Unknown query type: ${query.queryType}` });
    }
  }

  async contributeToBriefing(scope: string): Promise<BriefingSection> {
    const stale = await this.findStaleContacts(7);
    return {
      agentId: this.id,
      title: 'Pipeline & Relationships',
      content: stale.length > 0
        ? `**${stale.length} contacts need attention this week:**\n${stale.slice(0, 5).join('\n')}`
        : 'Pipeline healthy — all contacts engaged within 7 days.',
      priority: stale.length > 0 ? 1 : 3,
    };
  }

  private async scoreLead(profileContent: string): Promise<number> {
    const hasPhone = profileContent.includes('Phone:') ? 10 : 0;
    const hasEmail = profileContent.includes('Email:') ? 10 : 0;
    const hasBuyingCriteria = profileContent.includes('Buying Criteria') ? 20 : 0;
    const hasTimeline = profileContent.toLowerCase().includes('timeline') ? 15 : 0;
    const recentActivity = profileContent.includes(new Date().getFullYear().toString()) ? 20 : 0;
    const hasStage = profileContent.includes('Stage:') ? 10 : 0;
    return Math.min(100, hasPhone + hasEmail + hasBuyingCriteria + hasTimeline + recentActivity + hasStage + 15);
  }

  private async findStaleContacts(thresholdDays: number): Promise<string[]> {
    const results = await this.memSearch.search({ domain: 'contacts', query: 'contact', maxResults: 50 });
    const cutoff = Date.now() - thresholdDays * 86_400_000;
    const stale: string[] = [];

    for (const match of results.matches) {
      try {
        const mem = await this.readMemory({ path: match.path });
        if (new Date(mem.lastModified).getTime() < cutoff) {
          stale.push(match.path);
        }
      } catch {
        // Skip unreadable memory entries and continue scanning.
      }
    }

    return stale;
  }

  private async updateContactInteraction(payload: Record<string, unknown>): Promise<void> {
    const contactId = String(payload['contactId'] ?? '');
    if (!contactId) return;
    await this.writeMemory({
      path: `contacts/${contactId}.md`,
      operation: 'append',
      content: `Interaction recorded: ${payload['type'] ?? 'unknown'} at ${new Date().toISOString()}`,
      writtenBy: this.id,
    });
  }

  private async markPastClient(payload: Record<string, unknown>): Promise<void> {
    const contactId = String(payload['contactId'] ?? '');
    if (!contactId) return;
    await this.writeMemory({
      path: `contacts/${contactId}.md`,
      operation: 'update_section',
      section: 'Overview',
      content: `- **Stage:** Past Client\n- **Closed:** ${new Date().toISOString()}`,
      writtenBy: this.id,
    });

    // Trigger post-closing follow-up sequence in TransactionAgent
    const txAgent = this.agentRegistry?.get(AgentId.TRANSACTION);
    if (txAgent) {
      const req: TaskRequest = {
        messageId: uuidv4(),
        timestamp: new Date().toISOString(),
        correlationId: uuidv4(),
        type: 'TASK_REQUEST',
        fromAgent: this.id,
        toAgent: AgentId.TRANSACTION,
        priority: Priority.P3_BACKGROUND,
        taskType: 'post_closing',
        instructions: `Transaction closed for contact ${contactId}. Generate post-closing follow-up sequence.`,
        context: { clientId: this.tenantId, contactId },
        data: { contactId },
        constraints: { maxTokens: 2048, modelOverride: null, timeoutMs: 30_000, requiresApproval: false, approvalCategory: null },
      };
      txAgent.handleTask(req).catch(() => {});
    }
  }

  private async processOpenHouseSignup(payload: Record<string, unknown>): Promise<void> {
    const name = String(payload['name'] ?? 'Unknown');
    const email = String(payload['email'] ?? '');
    const contactId = email.replace(/[^a-z0-9]/gi, '-').toLowerCase() || `oh-${Date.now()}`;

    await this.writeMemory({
      path: `contacts/${contactId}.md`,
      operation: 'create',
      content: `# Contact: ${name}\n\n## Overview\n- **Name:** ${name}\n- **Email:** ${email}\n- **Stage:** Open House Lead\n- **Source:** Open House\n\n## Interaction History\n- Signed in at open house on ${new Date().toISOString()}`,
      writtenBy: this.id,
    }).catch(() => {
      // Contact may already exist — append instead
      this.writeMemory({
        path: `contacts/${contactId}.md`,
        operation: 'append',
        content: `Open house sign-in: ${new Date().toISOString()}`,
        writtenBy: this.id,
      });
    });

    this.emitEvent('contact.created', { contactId, source: 'open_house' });
  }
}
