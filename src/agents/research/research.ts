import { BaseAgent } from '../base-agent.js';
import { ModelTier } from '../../types/agents.js';
import { IntegrationId } from '../../types/integrations.js';
import type { TaskRequest, TaskResult, AgentQuery, QueryResponse, BriefingSection } from '../../types/messages.js';
import type { RentCastIntegration } from '../../integrations/rentcast.js';
import { query as dbQuery } from '../../db/postgres.js';

const NOT_CONNECTED = 'MLS data not connected. Set CLAW_RENTCAST_API_KEY in .env to enable market intelligence.';

export class ResearchAgent extends BaseAgent {
  async handleTask(request: TaskRequest): Promise<TaskResult> {
    const start = Date.now();
    try {
      switch (request.taskType) {
        case 'comp_analysis':
        case 'pull_comps': {
          const address = String(request.data['address'] ?? request.instructions);
          const mls = this.getIntegration<RentCastIntegration>(IntegrationId.RENTCAST);
          if (!mls) {
            return this.successResult(request, { text: NOT_CONNECTED }, { processingMs: Date.now() - start });
          }

          const radiusMiles = Number(request.data['radiusMiles'] ?? 1);
          const daysBack = Number(request.data['daysBack'] ?? 180);
          const comps = await mls.searchComps({ address, radiusMiles, daysBack });

          const analysis = await this.ask(
            `Analyze these comparable sales for: ${address}\n\nComps (${comps.length}):\n${JSON.stringify(comps, null, 2)}\n\nProvide: price per sqft analysis, value range estimate, DOM trends, and a recommended list price range.`,
            ModelTier.BALANCED,
          );

          return this.successResult(request, {
            text: analysis,
            comps,
            compCount: comps.length,
            address,
          }, { processingMs: Date.now() - start });
        }

        case 'market_data':
        case 'search_mls': {
          const mls = this.getIntegration<RentCastIntegration>(IntegrationId.RENTCAST);
          if (!mls) {
            return this.successResult(request, { text: NOT_CONNECTED }, { processingMs: Date.now() - start });
          }

          const zipCode = String(request.data['zipCode'] ?? request.data['zip'] ?? this.extractZip(request.instructions));
          const stats = await mls.getMarketStats(zipCode);

          const summary = await this.ask(
            `Summarize this market data for a real estate agent in a briefing-ready format.\n\nZip: ${zipCode}\nStats: ${JSON.stringify(stats, null, 2)}`,
            ModelTier.FAST,
          );

          return this.successResult(request, {
            text: summary,
            stats,
            zipCode,
          }, { processingMs: Date.now() - start });
        }

        case 'document_summarize': {
          const docContent = String(request.data['content'] ?? request.instructions);
          const summary = await this.ask(
            `Summarize this real estate document and flag any concerns:\n\n${docContent}`,
            ModelTier.BALANCED,
          );
          return this.successResult(request, { text: summary }, { processingMs: Date.now() - start });
        }

        case 'neighborhood_stats': {
          const mls = this.getIntegration<RentCastIntegration>(IntegrationId.RENTCAST);
          const neighborhood = request.instructions;
          const zip = this.extractZip(neighborhood);

          let statsText = '';
          if (mls && zip) {
            const stats = await mls.getMarketStats(zip).catch(() => null);
            if (stats) {
              statsText = `\n\nLive market data:\n${JSON.stringify(stats, null, 2)}`;
            }
          } else if (!mls) {
            statsText = `\n\n(${NOT_CONNECTED})`;
          }

          const report = await this.ask(
            `Research framework for neighborhood: ${neighborhood}${statsText}\n\nProvide: school ratings, walkability, key amenities, commute access, and buyer appeal summary.`,
            ModelTier.BALANCED,
          );

          await this.writeMemory({
            path: `knowledge/neighborhood-${neighborhood.replace(/\s/g, '-').toLowerCase()}.md`,
            operation: 'create',
            content: `# Neighborhood: ${neighborhood}\n\n${report}`,
            writtenBy: this.id,
          }).catch(() => {});

          return this.successResult(request, { text: report }, { processingMs: Date.now() - start });
        }

        case 'competitive_track': {
          const mls = this.getIntegration<RentCastIntegration>(IntegrationId.RENTCAST);
          const farmArea = String(request.data['area'] ?? request.instructions);
          const zip = this.extractZip(farmArea);

          if (!mls) {
            return this.successResult(request, { text: NOT_CONNECTED }, { processingMs: Date.now() - start });
          }

          const listings = zip ? await mls.getActiveListings(zip, 50).catch(() => []) : [];
          const stats = zip ? await mls.getMarketStats(zip).catch(() => null) : null;

          const analysis = await this.ask(
            `Competitive analysis for farm area: ${farmArea}\n\nActive listings (${listings.length}):\n${JSON.stringify(listings.slice(0, 10), null, 2)}\n\nMarket stats:\n${JSON.stringify(stats, null, 2)}\n\nIdentify: pricing opportunities, days-on-market outliers, price reduction candidates.`,
            ModelTier.BALANCED,
          );

          this.emitEvent('listing.status_change', {
            area: farmArea,
            type: 'competitive_scan',
            listingCount: listings.length,
          });

          return this.successResult(request, {
            text: analysis,
            listings,
            stats,
          }, { processingMs: Date.now() - start });
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
    if (query.queryType === 'market_data') {
      const mls = this.getIntegration<RentCastIntegration>(IntegrationId.RENTCAST);
      const area = String(query.parameters['area'] ?? '');

      if (!mls) {
        const data = await this.ask(`Provide market data summary for: ${area}`, ModelTier.FAST);
        return this.queryResponse(query, true, { summary: data });
      }

      const zip = this.extractZip(area);
      if (zip) {
        const stats = await mls.getMarketStats(zip).catch(() => null);
        if (stats) {
          return this.queryResponse(query, true, { summary: `Median: $${stats.medianSalePrice.toLocaleString()}, DOM: ${stats.avgDaysOnMarket}, Active: ${stats.activeListings}`, stats });
        }
      }

      const data = await this.ask(`Provide market data summary for: ${area}`, ModelTier.FAST);
      return this.queryResponse(query, true, { summary: data });
    }
    return this.queryResponse(query, false, { error: `Unknown query: ${query.queryType}` });
  }

  async contributeToBriefing(_scope: string): Promise<BriefingSection> {
    const mls = this.getIntegration<RentCastIntegration>(IntegrationId.RENTCAST);
    if (!mls) {
      return {
        agentId: this.id,
        title: 'Market Intelligence',
        content: NOT_CONNECTED,
        priority: 2,
      };
    }

    // Prefer DB-stored ZIP (set during onboarding), fall back to env var for local dev
    let clientZip = '';
    try {
      const row = await dbQuery<{ primary_zip: string | null }>(
        'SELECT primary_zip FROM tenants WHERE tenant_id = $1',
        [this.tenantId],
      );
      clientZip = row.rows[0]?.primary_zip ?? '';
    } catch { /* DB unavailable — fall through to env var */ }
    if (!clientZip) clientZip = process.env.CLAW_PRIMARY_ZIP ?? '';
    if (!clientZip) {
      return {
        agentId: this.id,
        title: 'Market Intelligence',
        content: 'Set your primary market ZIP in the app settings to see your market snapshot here.',
        priority: 2,
      };
    }

    try {
      const stats = await mls.getMarketStats(clientZip);
      const direction = stats.priceDirection === 'up' ? '↑' : stats.priceDirection === 'down' ? '↓' : '→';
      return {
        agentId: this.id,
        title: 'Market Intelligence',
        content: `${clientZip}: Median $${stats.medianSalePrice.toLocaleString()} ${direction} · DOM ${stats.avgDaysOnMarket} days · ${stats.activeListings} active · ${stats.newListingsLast7Days} new this week`,
        priority: 2,
      };
    } catch {
      return {
        agentId: this.id,
        title: 'Market Intelligence',
        content: 'Market data temporarily unavailable.',
        priority: 2,
      };
    }
  }

  private extractZip(text: string): string {
    const match = text.match(/\b(\d{5})\b/);
    return match?.[1] ?? '';
  }
}
