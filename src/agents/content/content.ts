import { v4 as uuidv4 } from 'uuid';
import { BaseAgent } from '../base-agent.js';
import { AgentId, ModelTier } from '../../types/agents.js';
import type { TaskRequest, TaskResult, AgentQuery, QueryResponse, BriefingSection } from '../../types/messages.js';
import log from '../../utils/logger.js';
import { query as dbQuery } from '../../db/postgres.js';

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
          const toneCtx = await this.getToneContext();
          const campaignJson = await this.ask(
            `Email campaign sequence for real estate: ${topic}${toneCtx}\nReturn JSON array [{dayOffset: number, subject: string, body: string}] for 5 emails max.\nExample: [{"dayOffset":0,"subject":"Just listed","body":"Exciting new listing!"}]`,
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
          const toneCtx = await this.getToneContext();
          const batch = await this.ask(
            `Create a social media batch for a real estate agent. Generate 3 posts:\n1. Instagram (visual, 150 chars max, 5 hashtags)\n2. Facebook (conversational, 300 chars)\n3. LinkedIn (professional, 400 chars)\n\nTopic: ${topic}${toneCtx}`,
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
          const toneCtx = await this.getToneContext();
          const guide = await this.ask(
            `Create comprehensive neighborhood guide for ${area}:\nKB data: ${kbData}${toneCtx}\n\nSections: overview, schools, commute, amenities, market trends, buyer appeal.`,
            ModelTier.BALANCED,
          );
          // Persist guide to knowledge base for future reference
          const safeName = area.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
          void this.writeMemory({
            path: `market-data/neighborhood-guide-${safeName}.md`,
            operation: 'create',
            content: `# Neighborhood Guide: ${area}\n\nGenerated: ${new Date().toISOString()}\n\n${guide}`,
            writtenBy: this.id,
          }).catch(() => {});
          return this.successResult(request, { text: guide }, { processingMs: Date.now() - start });
        }

        case 'vision_extract': {
          const keyFeatures = String(request.data['keyFeatures'] ?? request.instructions);
          const featureJson = await this.ask(
            `Extract structured property features from this description. Return JSON with fields: propertyType, bedBath, keyFeatures (array), conditionSignals (array), styleEra, standoutAttributes (array).\n\nDescription: ${keyFeatures}`,
            ModelTier.BALANCED,
          );
          let parsed: object = {};
          try {
            const match = featureJson.match(/\{[\s\S]*\}/);
            parsed = match ? JSON.parse(match[0]) : { raw: featureJson };
          } catch {
            parsed = { raw: featureJson };
          }
          return this.successResult(request, { featureJson: parsed, text: featureJson }, { processingMs: Date.now() - start });
        }

        case 'studio_generate': {
          const preset = String(request.data['preset'] ?? 'new_listing');
          const tone = String(request.data['tone'] ?? 'Standard');
          const textPrompt = String(request.data['textPrompt'] ?? request.data['keyFeatures'] ?? request.instructions);
          const images = (request.data['images'] as string[] | undefined) ?? [];
          const platforms = (request.data['platforms'] as string[] | undefined) ?? ['MLS', 'Instagram', 'Facebook'];
          const contactId = String(request.data['contactId'] ?? '');
          const listingId = request.data['listingId'] ? String(request.data['listingId']) : null;

          // Fetch listing property context if listingId provided
          let propertyContext = '';
          if (listingId) {
            try {
              type ListingRow = {
                address: string; city: string | null; state: string | null; zip: string | null;
                price: number | null; beds: number | null; baths: number | null;
                sqft: number | null; lot_sqft: number | null; year_built: number | null;
                description: string | null; features: string[]; advanced_data: Record<string, unknown>;
              };
              const rows = await dbQuery<ListingRow>(
                'SELECT address, city, state, zip, price, beds, baths, sqft, lot_sqft, year_built, description, features, advanced_data FROM listings WHERE id = $1 AND tenant_id = $2',
                [listingId, this.tenantId],
              );
              const l = rows[0];
              if (l) {
                const estValue = l.advanced_data['estimatedValue'] as number | undefined;
                const parts = [
                  `Property: ${l.beds ?? '?'}BR/${l.baths ?? '?'}BA | ${l.sqft ?? '?'} sqft | lot ${l.lot_sqft ?? '?'} sqft`,
                  `Address: ${l.address}${l.city ? `, ${l.city}` : ''}${l.state ? `, ${l.state}` : ''}${l.zip ? ` ${l.zip}` : ''}`,
                  `Year Built: ${l.year_built ?? 'unknown'} | List Price: ${l.price ? `$${l.price.toLocaleString()}` : 'TBD'}${estValue ? ` | Est. Value: $${estValue.toLocaleString()}` : ''}`,
                ];
                const features = Array.isArray(l.features) && l.features.length > 0 ? l.features.join(', ') : null;
                if (features) parts.push(`Features: ${features}`);
                if (l.description) parts.push(`Description: ${l.description}`);
                propertyContext = `\n\nProperty details:\n${parts.join('\n')}`;
              }
            } catch { /* DB unavailable — proceed without listing context */ }
          }

          // Fetch contact profile for personalized copy
          let contactContext = '';
          if (contactId) {
            try {
              const contactQuery: AgentQuery = {
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
              const contactResp = await this.queryAgent(AgentId.RELATIONSHIP, contactQuery);
              if (contactResp.found) contactContext = String(contactResp.data['profile'] ?? '');
            } catch { /* optional — proceed without contact context */ }
          }

          let featureData = request.data['featureJson'] ? JSON.stringify(request.data['featureJson']) : textPrompt;

          // Vision-first path: extract property features from images
          if (images.length > 0 && !request.data['featureJson']) {
            const visionResponse = await this.callLlm(
              `User description: ${textPrompt}. Extract structured property features.`,
              ModelTier.BALANCED,
              {
                messages: [{
                  role: 'user',
                  content: [
                    ...images.map(img => ({
                      type: 'image' as const,
                      source: { type: 'base64' as const, mediaType: 'image/jpeg' as const, data: img },
                    })),
                    { type: 'text' as const, text: `User description: ${textPrompt}. Extract structured JSON: { propertyType, bedBath, keyFeatures[], conditionSignals[], styleEra, standoutAttributes[] }.` },
                  ],
                }],
              },
            );
            featureData = visionResponse.text;
          }

          const platformInstructions = this.buildPlatformInstructions(platforms, preset);
          const toneCtx = await this.getToneContext();

          const contactSection = contactContext
            ? `\n\nPersonalized for buyer:\n${contactContext}\nHighlight features that match their stated criteria and budget where relevant.`
            : '';

          const agentNotes = propertyContext
            ? (textPrompt ? `\n\nAgent notes: ${textPrompt}` : '')
            : '';

          const rawOutput = await this.ask(
            `You are writing marketing copy for a real estate agent with a ${tone} tone.${toneCtx}${propertyContext}\n\nProperty features: ${featureData}${agentNotes}${contactSection}\n\n${platformInstructions}\n\nReturn as JSON with only the requested platform fields.`,
            ModelTier.BALANCED,
          );

          let drafts: Record<string, string> = {};
          try {
            const match = rawOutput.match(/\{[\s\S]*\}/);
            if (match) drafts = JSON.parse(match[0]) as Record<string, string>;
          } catch { drafts = { mlsDescription: rawOutput }; }

          const complianceText = Object.values(drafts).join(' ');
          const compliance = await this.checkContentCompliance(complianceText);

          return this.successResult(request, {
            text: JSON.stringify({ ...drafts, complianceFlags: compliance.flags, featureJson: featureData }),
            ...drafts,
            complianceFlags: compliance.flags,
          }, {
            approval: compliance.flags.length > 0 ? undefined : {
              actionType: 'post_social',
              preview: (drafts['instagramCaption'] ?? drafts['mlsDescription'] ?? '').slice(0, 200),
              recipients: [],
            },
            processingMs: Date.now() - start,
          });
        }

        case 'virtual_staging': {
          const images = (request.data['images'] as string[] | undefined) ?? [];
          const style = String(request.data['textPrompt'] ?? 'Modern');
          if (!images[0]) {
            return this.failureResult(request, new Error('No image provided for virtual staging'));
          }
          const stagedUrl = await this.stageRoom(images[0], style);
          return this.successResult(
            request,
            { text: JSON.stringify({ stagedImageUrl: stagedUrl }), stagedImageUrl: stagedUrl },
            { processingMs: Date.now() - start },
          );
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

  private async getToneContext(): Promise<string> {
    const parts: string[] = [];
    try {
      const m = await this.readMemory({ path: 'client-profile/tone-model.md' });
      if (m.content.trim()) parts.push(`Writing style (AI-analyzed from sent emails):\n${m.content.trim()}`);
    } catch { /* not yet generated */ }
    try {
      const p = await this.readMemory({ path: 'client-profile/tone-prefs.md' });
      if (p.content.trim()) parts.push(`Explicit tone preferences:\n${p.content.trim()}`);
    } catch { /* not configured */ }
    return parts.length > 0 ? `\n\n${parts.join('\n\n')}` : '';
  }

  private async generateListingVariants(listingData: string): Promise<{
    standard: string; story: string; bullet: string; luxury: string;
  }> {
    // Read agent identity footer for advertising disclosure (state law requires brokerage name + license in all ads)
    let adDisclosure = '';
    try {
      const f = await this.readMemory({ path: 'client-profile/footer.md' });
      if (f.content.trim()) adDisclosure = `\n\nRequired advertising disclosure to append to every variant:\n${f.content.trim()}`;
    } catch { /* not yet configured — omit disclosure */ }

    const prompt = `Generate 4 listing description variants for this property. Each must be unique, accurate, and fair-housing compliant.

Property data: ${listingData}${adDisclosure}

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

  private buildPlatformInstructions(platforms: string[], preset: string): string {
    const parts: string[] = [];
    if (platforms.includes('MLS')) {
      const wordCount = preset === 'just_sold' ? 150 : preset === 'price_reduction' ? 150 : 200;
      const label = preset === 'just_sold' ? 'Just Sold MLS announcement' : preset === 'price_reduction' ? 'Price Reduction MLS announcement' : 'MLS description';
      parts.push(`mlsDescription: ${label} (${wordCount} words, fair-housing compliant)`);
    }
    if (platforms.includes('Instagram')) {
      parts.push('instagramCaption: Instagram caption (150 chars max, 5 relevant hashtags)');
    }
    if (platforms.includes('Facebook')) {
      parts.push('facebookPost: Facebook post (300 chars, conversational tone)');
    }
    if (platforms.includes('Email')) {
      parts.push('emailContent: Email body (subject line + 3 paragraphs, professional)');
    }
    if (platforms.includes('SMS')) {
      parts.push('smsText: SMS message (160 chars max, concise, no links)');
    }
    return `Generate the following JSON fields:\n${parts.map(p => `- "${p}"`).join('\n')}`;
  }

  private async stageRoom(imageBase64: string, style: string): Promise<string> {
    const apiKey = process.env['OPENAI_API_KEY'];
    if (!apiKey) throw new Error('OPENAI_API_KEY not configured for virtual staging');

    const prompt = `Virtually stage this empty room in a ${style} interior design style. Add appropriate furniture, lighting, artwork, and decor. Keep the room dimensions, windows, doors, and architectural features unchanged. Produce a photorealistic result that looks like a professional real estate listing photo.`;

    try {
      // Attempt gpt-image-1 via multipart form (higher quality)
      const form = new FormData();
      form.append('model', 'gpt-image-1');
      form.append('prompt', prompt);
      form.append('n', '1');
      form.append('size', '1024x1024');
      const imageBuffer = Buffer.from(imageBase64, 'base64');
      form.append('image', new Blob([imageBuffer], { type: 'image/jpeg' }), 'room.jpg');

      const response = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });

      if (!response.ok) throw new Error(await response.text());

      const result = await response.json() as { data?: [{ url?: string; b64_json?: string }] };
      const item = result.data?.[0];
      if (item?.url) return item.url;
      if (item?.b64_json) return `data:image/png;base64,${item.b64_json}`;
      throw new Error('No image in gpt-image-1 response');
    } catch {
      // Fallback to dall-e-2
      return this.stageRoomDallE2(imageBase64, style, apiKey);
    }
  }

  private async stageRoomDallE2(imageBase64: string, style: string, apiKey: string): Promise<string> {
    const prompt = `Virtually stage this empty room in a ${style} interior design style. Add appropriate furniture, lighting, artwork, and decor. Keep the room dimensions, windows, doors, and architectural features unchanged. Produce a photorealistic result that looks like a professional real estate listing photo.`;

    const response = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'dall-e-2',
        image: imageBase64,
        prompt,
        n: 1,
        size: '1024x1024',
        response_format: 'url',
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Virtual staging API error: ${err.slice(0, 200)}`);
    }

    const result = await response.json() as { data?: [{ url?: string }] };
    const url = result.data?.[0]?.url;
    if (!url) throw new Error('No staged image URL returned');
    return url;
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
      // Fail-secure: if the compliance agent is unavailable, block rather than pass.
      // Failing open here would allow non-compliant content to publish silently.
      log.warn('[ContentAgent] Compliance check unavailable — blocking content for review');
      return { passed: false, flags: ['compliance_check_unavailable'] };
    }
  }
}

