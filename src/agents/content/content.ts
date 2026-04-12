import { v4 as uuidv4 } from 'uuid';
import { BaseAgent } from '../base-agent.js';
import { AgentId, ModelTier } from '../../types/agents.js';
import type { TaskRequest, TaskResult, AgentQuery, QueryResponse, BriefingSection } from '../../types/messages.js';

export class ContentAgent extends BaseAgent {
  async handleTask(request: TaskRequest): Promise<TaskResult> {
    const start = Date.now();
    try {
      switch (request.taskType) {
        case 'listing_description':
        case 'write_listing': {
          const listingData = request.data['listing'] ?? request.instructions;
          const variants = await this.generateListingVariants(String(listingData));
          return this.successResult(request, { text: variants.standard, variants }, { resultType: 'text', processingMs: Date.now() - start });
        }

        case 'email_campaign_content': {
          const topic = request.data['topic'] ?? request.instructions;
          const campaignJson = await this.ask(
            `Email campaign sequence for real estate: ${topic}\nReturn JSON array [{dayOffset: number, subject: string, body: string}] for 5 emails max.\nExample: [{"dayOffset":0,"subject":"Just listed","body":"Exciting new listing!"}]`,
            ModelTier.BALANCED,
          );
          let campaign = [];
          try {
            campaign = JSON.parse(campaignJson.match(/\\[\\s\\S]*\\]/)?.[0] ?? '[]');
          } catch {
            campaign = [{ dayOffset: 0, subject: 'Campaign', body: campaignJson }];
          }
          return this.successResult(request, { campaign }, { processingMs: Date.now() - start });
        }

        case 'social_batch':
        case 'create_post': {
          const topic = request.data['topic'] ?? request.instructions;
          const batch = await this.ask(
            `Create a social media batch for a real estate agent. Generate 3 posts:\n1. Instagram (visual, 150 chars max, 5 hashtags)\n2. Facebook (conversational, 300 chars)\n3. LinkedIn (professional, 400 chars)\n\nTopic: ${topic}`,
            ModelTier.BALANCED,
          );
          return this.successResult(request, { text: batch }, {
            approval: {
              actionType: 'post_social',
              preview: batch.slice(0, 200),
              recipients: [],
            },
            processingMs: Date.now() - start,
          });
        }

        case 'market_report': {
          const area = String(request.data['area'] ?? request.instructions);
          const kbData = await this.getKnowledgeBaseData(area);
          const report = await this.ask(
            `Create a professional market report for: ${area}\n\nAvailable data:\n${kbData}\n\nInclude: supply/demand, price trends, days on market, neighborhood highlights.`,
            ModelTier.BALANCED,
          );
          return this.successResult(request, { text: report }, { processingMs: Date.now() - start });
        }

        case 'just_sold': {
          const listing = String(request.data['listing'] ?? request.instructions);
          const announcement = await this.ask(
            `Write a professional "Just Sold" announcement for social media and email.\n\nProperty: ${listing}\n\nCreate: 1 social caption + 1 email subject + 1 email body.`,
            ModelTier.BALANCED,
          );
          return this.successResult(request, { text: announcement }, {
            approval: {
              actionType: 'post_social',
              preview: announcement.slice(0, 200),
              recipients: [],
            },
            processingMs: Date.now() - start,
          });
        }

        case 'neighborhood_guide': {
          const area = String(request.data['area'] ?? request.instructions);
          const kbData = await this.getKnowledgeBaseData(area);
          const compliance = await this.checkContentCompliance(area);
          if (!compliance.passed) {
            return this.successResult(request, { complianceIssues: compliance.flags }, { processingMs: Date.now() - start });
          }
          const guide = await this.ask(
            `Create comprehensive neighborhood guide for ${area}:\nKB data: ${kbData}\n\nSections: overview, schools, commute, amenities, market trends, buyer appeal.`,
            ModelTier.BALANCED,
          );
          return this.successResult(request, { text: guide }, { processingMs: Date.now() - start });
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
    return this.queryResponse(query, false, { error: 'Content agent does not support queries' });
  }

  async contributeToBriefing(scope: string): Promise<BriefingSection> {
    return {
      agentId: this.id,
      title: 'Content Queue',
      content: 'No pending content tasks.',
      priority: 3,
    };
  }

  private async generateListingVariants(listingData: string): Promise<{
    standard: string; story: string; bullet: string; luxury: string;
  }> {
    const prompt = `Generate 4 listing description variants for this property. Each must be unique, accurate, and fair-housing compliant.

Property data: ${listingData}

Format as JSON with keys: standard (MLS standard, 200 words), story (narrative, 150 words), bullet (bullet points, 8 items), luxury (premium tone, 200 words).`;

    const raw = await this.ask(prompt, ModelTier.BALANCED);
    try {
      return JSON.parse(raw) as { standard: string; story: string; bullet: string; luxury: string };
    } catch {
      return { standard: raw, story: raw, bullet: raw, luxury: raw };
    }
  }

  private async getKnowledgeBaseData(area: string): Promise<string> {
    try {
      const query: AgentQuery = {
        messageId: uuidv4(),
        timestamp: new Date().toISOString(),
        correlationId: uuidv4(),
        type: 'AGENT_QUERY',
        fromAgent: this.id,
        toAgent: AgentId.KNOWLEDGE_BASE,
        queryType: 'knowledge_lookup',
        parameters: { query: area },
        urgency: 'blocking',
      };
      const response = await this.queryAgent(AgentId.KNOWLEDGE_BASE, query);
      const results = response.data['results'] as { snippet: string }[] | undefined;
      return results?.map(r => r.snippet).join('\n') ?? 'No local data available.';
    } catch {
      return 'No local data available.';
    }
  }

  private async checkContentCompliance(content: string): Promise<{ passed: boolean; flags: string[] }> {
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
      const flags = (response.data['flags'] as { text: string }[] | undefined)?.map(f => f.text) ?? [];
      return {
        passed: response.data['passed'] as boolean ?? true,
        flags,
      };
    } catch {
      return { passed: true, flags: [] };
    }
  }
}

