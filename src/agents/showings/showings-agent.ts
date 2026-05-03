import { v4 as uuidv4 } from 'uuid';
import { BaseAgent } from '../base-agent.js';
import { AgentId, ModelTier, Priority } from '../../types/agents.js';
import type {
  TaskRequest,
  TaskResult,
  AgentQuery,
  QueryResponse,
  BriefingSection,
} from '../../types/messages.js';
import type { EventType } from '../../types/events.js';
import { IntegrationId } from '../../types/integrations.js';
import type { CrmlsIntegration, BuyerCriteria } from '../../integrations/crmls.js';
import type { GoogleMapsIntegration } from '../../integrations/google-maps.js';
import { query as dbQuery } from '../../db/postgres.js';
import { optimizeRoute } from '../../features/routing/route-optimizer.js';
import type { RouteStop } from '../../features/routing/route-optimizer.js';
import { buildAccessPlan } from '../../features/showings/access-negotiator.js';
import type { ShowingType } from '../../features/showings/access-negotiator.js';
import log from '../../utils/logger.js';

// ─── Local DB row shapes ───────────────────────────────────────────────────────

interface StopRow {
  id: string;
  address: string;
  showing_type: string;
  showing_instructions: string | null;
  listing_agent_phone: string | null;
  listing_agent_email: string | null;
  latitude: string | null;
  longitude: string | null;
  duration_minutes: number;
  access_status: string;
  property_result_id: string | null;
}

interface PropertyResultRow {
  id: string;
  address: string;
  raw_listing: string | null;
  field_oracle_cache: string | null;
  oracle_cached_at: string | null;
  match_score: number | null;
  matched_criteria: string | null;
  missing_criteria: string | null;
}

// ─── ShowingsAgent ─────────────────────────────────────────────────────────────

export class ShowingsAgent extends BaseAgent {

  // ─── Task dispatcher ────────────────────────────────────────────────────────

  async handleTask(request: TaskRequest): Promise<TaskResult> {
    const start = Date.now();
    try {
      switch (request.taskType) {
        case 'property_match':           return await this.propertyMatch(request, start);
        case 'showing_day_propose':      return await this.showingDayPropose(request, start);
        case 'showing_access_negotiate': return await this.accessNegotiate(request, start);
        case 'route_optimize':           return await this.routeOptimize(request, start);
        case 'field_oracle':             return await this.fieldOracle(request, start);
        case 'post_tour_report':         return await this.postTourReport(request, start);
        case 'heartbeat':                return this.successResult(request, { status: 'ready' }, { processingMs: Date.now() - start });
        default: {
          const text = await this.ask(request.instructions, ModelTier.BALANCED);
          return this.successResult(request, { text }, { processingMs: Date.now() - start });
        }
      }
    } catch (err) {
      log.error(`[ShowingsAgent] Task failed: ${request.taskType}`, { error: (err as Error).message });
      return this.failureResult(request, err as Error);
    }
  }

  // ─── Event subscriptions ────────────────────────────────────────────────────

  protected override async onEvent(
    eventType: EventType,
    payload: Record<string, unknown>,
  ): Promise<void> {
    switch (eventType) {
      case 'contact.created': {
        const contactId = String(payload['contactId'] ?? '');
        if (contactId) await this.dispatchPropertyMatch(contactId, payload['correlationId'] as string | undefined);
        break;
      }
      case 'contact.updated': {
        // Re-queue if buying criteria changed
        const contactId = String(payload['contactId'] ?? '');
        const criteriaChanged = Boolean(payload['criteriaChanged']);
        if (contactId && criteriaChanged) {
          await this.dispatchPropertyMatch(contactId, payload['correlationId'] as string | undefined);
        }
        break;
      }
      case 'showing.access_confirmed': {
        const showingDayId = String(payload['showingDayId'] ?? '');
        if (showingDayId) await this.checkAndFireRouteOptimize(showingDayId);
        break;
      }
      case 'showing.day_completed': {
        const showingDayId = String(payload['showingDayId'] ?? '');
        if (showingDayId) await this.dispatchPostTourReport(showingDayId, payload['correlationId'] as string | undefined);
        break;
      }
    }
  }

  // ─── Capability: property_match ─────────────────────────────────────────────

  private async propertyMatch(request: TaskRequest, start: number): Promise<TaskResult> {
    const contactId = String(request.data['contactId'] ?? request.context.contactId ?? '');
    if (!contactId) return this.failureResult(request, new Error('contactId required'));

    const crmls = this.getIntegration<CrmlsIntegration>(IntegrationId.CRMLS);
    if (!crmls) {
      return this.successResult(request, {
        text: 'CRMLS is not connected. Enable it in Settings → Integrations to activate property curation.',
      }, { processingMs: Date.now() - start });
    }

    // 1. Read buying criteria from contact memory
    const criteria = await this.extractBuyerCriteria(contactId, request.instructions);

    // 2. Search CRMLS
    const listings = await crmls.searchByBuyerCriteria(criteria, 30);
    if (listings.length === 0) {
      return this.successResult(request, {
        text: 'No active listings found matching the buyer criteria.',
        contactId,
        count: 0,
      }, { processingMs: Date.now() - start });
    }

    // 3. Batch-score all listings in one FAST LLM call
    const scores = await this.batchScore(listings, criteria);

    // 4. Persist search + results
    const searchRow = await dbQuery<{ id: string }>(
      `INSERT INTO property_searches (tenant_id, contact_id, criteria_snapshot, result_count)
       VALUES ($1, $2, $3::jsonb, $4) RETURNING id`,
      [this.tenantId, contactId, JSON.stringify(criteria), listings.length],
    );
    const searchId = searchRow.rows[0]?.id ?? uuidv4();

    await Promise.allSettled(
      listings.map(async (listing, i) => {
        const score = scores.find(s => s.id === listing.mlsNumber) ?? { score: 50, matchedCriteria: [], missingCriteria: [], compensatingFactors: [] };
        await dbQuery(
          `INSERT INTO property_results (
             tenant_id, search_id, mls_number, address, city, zip_code, price, beds, baths,
             sqft, lot_sqft, year_built, dom, pool, garage_spaces, photos,
             listing_agent_name, listing_agent_phone, listing_agent_email,
             showing_instructions, showing_type,
             latitude, longitude,
             match_score, matched_criteria, missing_criteria, compensating_factors,
             raw_listing
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,
             $10,$11,$12,$13,$14,$15,$16::jsonb,
             $17,$18,$19,
             $20,$21,
             $22,$23,
             $24,$25::jsonb,$26::jsonb,$27::jsonb,
             $28::jsonb
           )`,
          [
            this.tenantId, searchId,
            listing.mlsNumber, listing.address, listing.city, listing.zip,
            listing.price, listing.beds, listing.baths,
            listing.sqft, listing.lotSqft, listing.yearBuilt, listing.dom,
            listing.pool ?? false, listing.garageSpaces ?? null,
            JSON.stringify(listing.photos),
            listing.listingAgent.name, listing.listingAgent.phone, listing.listingAgent.email,
            listing.showingInstructions ?? null, listing.showingType ?? 'unknown',
            listing.latitude ?? null, listing.longitude ?? null,
            score.score,
            JSON.stringify(score.matchedCriteria),
            JSON.stringify(score.missingCriteria),
            JSON.stringify(score.compensatingFactors),
            JSON.stringify(listing),
          ],
        );
        void i; // suppress unused-var lint
      }),
    );

    const topScore = Math.max(...scores.map(s => s.score), 0);

    // 5. Push WS event
    this.pushWsEvent('PROPERTY_CURATION_READY', request.correlationId, {
      searchId,
      contactId,
      count: listings.length,
      topMatchScore: topScore,
    });

    return this.successResult(request, {
      text: `Found and scored ${listings.length} properties for contact ${contactId}. Top match: ${topScore}/100.`,
      searchId,
      contactId,
      count: listings.length,
      topMatchScore: topScore,
    }, { processingMs: Date.now() - start });
  }

  // ─── Capability: showing_day_propose ───────────────────────────────────────

  private async showingDayPropose(request: TaskRequest, start: number): Promise<TaskResult> {
    const contactId = String(request.data['contactId'] ?? request.context.contactId ?? '');
    if (!contactId) return this.failureResult(request, new Error('contactId required'));

    // 1. Load top-scored properties for this contact
    const props = await dbQuery<{ id: string; address: string; match_score: number }>(
      `SELECT pr.id, pr.address, pr.match_score
         FROM property_results pr
         JOIN property_searches ps ON pr.search_id = ps.id
        WHERE ps.tenant_id = $1 AND ps.contact_id = $2
          AND pr.match_score >= 60
        ORDER BY pr.match_score DESC
        LIMIT 10`,
      [this.tenantId, contactId],
    );

    const stopCount = Math.max(props.rows.length, 3);
    const estMinutes = stopCount * 30 + stopCount * 20; // 30 min/stop + 20 min drive buffer

    // 2. Query calendar agent for availability
    let availSlots: Array<{ date: string; start: string; end: string }> = [];
    try {
      const calQuery: AgentQuery = {
        messageId: uuidv4(),
        timestamp: new Date().toISOString(),
        correlationId: request.correlationId,
        type: 'AGENT_QUERY',
        fromAgent: this.id,
        toAgent: AgentId.CALENDAR,
        queryType: 'schedule_check',
        parameters: {
          daysAhead: 10,
          minBlockMinutes: estMinutes,
          excludeWeekends: false,
        },
        urgency: 'blocking',
      };
      const calResponse = await this.queryAgent(AgentId.CALENDAR, calQuery);
      if (calResponse.found && Array.isArray(calResponse.data['slots'])) {
        availSlots = calResponse.data['slots'] as typeof availSlots;
      }
    } catch {
      // Calendar not available — propose generic weekday slots
    }

    // 3. Build 3 candidate options (use calendar slots or reasonable defaults)
    const options = this.buildDayOptions(availSlots, estMinutes);

    // 4. Insert showing_day drafts
    const dayIds: string[] = [];
    for (const opt of options) {
      const row = await dbQuery<{ id: string }>(
        `INSERT INTO showing_days (tenant_id, contact_id, proposed_date, proposed_start_time, proposed_end_time, status)
         VALUES ($1,$2,$3,$4,$5,'draft') RETURNING id`,
        [this.tenantId, contactId, opt.date, opt.start, opt.end],
      );
      if (row.rows[0]) dayIds.push(row.rows[0].id);
    }

    const showingDayId = dayIds[0] ?? uuidv4();

    // 5. Push WS event
    const wsOptions = options.map((opt, i) => ({
      date:       opt.date,
      start:      opt.start,
      end:        opt.end,
      labelShort: this.formatDayLabel(opt.date, opt.start, opt.end),
      showingDayId: dayIds[i] ?? '',
    }));

    this.pushWsEvent('SHOWING_DAY_PROPOSED', request.correlationId, {
      showingDayId,
      contactId,
      options: wsOptions,
    });

    return this.successResult(request, {
      text: `Proposed ${options.length} showing day options for contact ${contactId}.`,
      showingDayId,
      contactId,
      options: wsOptions,
    }, { processingMs: Date.now() - start });
  }

  // ─── Capability: showing_access_negotiate ──────────────────────────────────

  private async accessNegotiate(request: TaskRequest, start: number): Promise<TaskResult> {
    const showingDayId = String(request.data['showingDayId'] ?? '');
    if (!showingDayId) return this.failureResult(request, new Error('showingDayId required'));

    const proposedDate = request.data['proposedDate'] as string | undefined;

    // Load all stops for this day
    const stopsResult = await dbQuery<StopRow>(
      `SELECT sdp.id, sdp.address, sdp.duration_minutes, sdp.access_status, sdp.property_result_id,
              COALESCE(pr.showing_type, 'unknown') AS showing_type,
              pr.showing_instructions, pr.listing_agent_phone, pr.listing_agent_email,
              pr.latitude::text, pr.longitude::text
         FROM showing_day_properties sdp
         LEFT JOIN property_results pr ON sdp.property_result_id = pr.id
        WHERE sdp.showing_day_id = $1
        ORDER BY sdp.sequence_order`,
      [showingDayId],
    );

    const stops = stopsResult.rows;
    if (stops.length === 0) {
      return this.failureResult(request, new Error('No stops found for showing day'));
    }

    // Process all stops in parallel
    const approvalItems: Array<{
      index: number;
      actionType: 'send_sms';
      preview: string;
      medium: 'sms';
      recipients: string[];
      stopId: string;
    }> = [];

    await Promise.allSettled(
      stops.map(async (stop, idx) => {
        const plan = buildAccessPlan(
          stop.showing_type as ShowingType,
          stop.address,
          stop.showing_instructions,
          stop.listing_agent_phone,
          proposedDate,
        );

        switch (plan.type) {
          case 'auto_confirm': {
            await dbQuery(
              `UPDATE showing_day_properties SET access_status = 'not_needed', access_notes = 'Go direct / lockbox'
                WHERE id = $1`,
              [stop.id],
            );
            this.emitEvent('showing.access_confirmed', { showingDayId, showingDayPropertyId: stop.id, status: 'not_needed' });
            this.pushWsEvent('SHOWING_ACCESS_UPDATE', request.correlationId, {
              showingDayPropertyId: stop.id,
              showingDayId,
              address: stop.address,
              status: 'not_needed',
              notes: 'Go direct / lockbox',
            });
            break;
          }

          case 'sms_draft': {
            await dbQuery(
              `UPDATE showing_day_properties SET access_status = 'negotiating' WHERE id = $1`,
              [stop.id],
            );
            approvalItems.push({
              index: idx,
              actionType: 'send_sms',
              preview: plan.draft.slice(0, 200),
              medium: 'sms',
              recipients: [plan.recipientPhone],
              stopId: stop.id,
            });
            this.pushWsEvent('SHOWING_ACCESS_UPDATE', request.correlationId, {
              showingDayPropertyId: stop.id,
              showingDayId,
              address: stop.address,
              status: 'negotiating',
              notes: null,
            });
            break;
          }

          case 'browser_navigate': {
            await dbQuery(
              `UPDATE showing_day_properties SET access_status = 'negotiating',
                access_notes = $1 WHERE id = $2`,
              [`Platform booking URL: ${plan.url}`, stop.id],
            );
            this.pushWsEvent('SHOWING_ACCESS_UPDATE', request.correlationId, {
              showingDayPropertyId: stop.id,
              showingDayId,
              address: stop.address,
              status: 'negotiating',
              notes: `Platform booking: ${plan.url}`,
            });
            break;
          }

          case 'manual_required': {
            await dbQuery(
              `UPDATE showing_day_properties SET access_status = 'pending',
                access_notes = $1 WHERE id = $2`,
              [plan.instructions, stop.id],
            );
            this.pushWsEvent('SHOWING_ACCESS_UPDATE', request.correlationId, {
              showingDayPropertyId: stop.id,
              showingDayId,
              address: stop.address,
              status: 'pending',
              notes: plan.instructions,
            });
            break;
          }
        }
      }),
    );

    // If there are SMS approval items, return needs_approval
    if (approvalItems.length > 0) {
      const approvalId = uuidv4();
      return this.successResult(request, {
        text: `Access negotiation complete. ${approvalItems.length} SMS draft(s) ready for approval.`,
        showingDayId,
        pendingSmsCount: approvalItems.length,
      }, {
        approval: {
          actionType: 'send_sms',
          preview: `${approvalItems.length} access request SMS(s) to listing agents`,
          recipients: approvalItems.flatMap(i => i.recipients),
          medium: 'sms',
        },
        sideEffects: approvalItems.map(item => ({
          targetAgent: AgentId.COMMS,
          action: 'send_sms',
          data: {
            recipientPhone: item.recipients[0],
            body: item.preview,
            stopId: item.stopId,
            showingDayId,
          },
        })),
        processingMs: Date.now() - start,
      });
      void approvalId;
    }

    return this.successResult(request, {
      text: `Access negotiation complete for ${stops.length} stop(s).`,
      showingDayId,
    }, { processingMs: Date.now() - start });
  }

  // ─── Capability: route_optimize ────────────────────────────────────────────

  private async routeOptimize(request: TaskRequest, start: number): Promise<TaskResult> {
    const showingDayId = String(request.data['showingDayId'] ?? '');
    const originAddress = String(request.data['originAddress'] ?? request.instructions ?? '');
    if (!showingDayId) return this.failureResult(request, new Error('showingDayId required'));

    // 1. Check all stops are resolved
    const pendingCheck = await dbQuery<{ count: string }>(
      `SELECT COUNT(*) AS count FROM showing_day_properties
        WHERE showing_day_id = $1
          AND access_status NOT IN ('confirmed','not_needed','failed')`,
      [showingDayId],
    );
    const pendingCount = parseInt(pendingCheck.rows[0]?.count ?? '0', 10);
    if (pendingCount > 0) {
      return this.successResult(request, {
        text: `Route optimization blocked: ${pendingCount} stop(s) still awaiting access confirmation.`,
        showingDayId,
        pendingCount,
      }, { processingMs: Date.now() - start });
    }

    // 2. Load stops
    const stopsResult = await dbQuery<StopRow>(
      `SELECT sdp.id, sdp.address, sdp.duration_minutes, sdp.access_status,
              pr.latitude::text, pr.longitude::text,
              NULL AS showing_type, NULL AS showing_instructions,
              NULL AS listing_agent_phone, NULL AS listing_agent_email,
              NULL AS property_result_id
         FROM showing_day_properties sdp
         LEFT JOIN property_results pr ON sdp.property_result_id = pr.id
        WHERE sdp.showing_day_id = $1
          AND sdp.access_status IN ('confirmed','not_needed')
        ORDER BY sdp.sequence_order`,
      [showingDayId],
    );

    if (stopsResult.rows.length === 0) {
      return this.failureResult(request, new Error('No confirmed stops found for route'));
    }

    const maps = this.getIntegration<GoogleMapsIntegration>(IntegrationId.GOOGLE_MAPS);
    if (!maps) {
      return this.failureResult(request, new Error('Google Maps integration not connected'));
    }

    // 3. Get showing day for start time
    const dayRow = await dbQuery<{ proposed_date: string; proposed_start_time: string | null }>(
      `SELECT proposed_date, proposed_start_time FROM showing_days WHERE id = $1`,
      [showingDayId],
    );
    const dayInfo = dayRow.rows[0];
    const startTime = dayInfo
      ? `${dayInfo.proposed_date}T${dayInfo.proposed_start_time ?? '09:00:00'}`
      : undefined;

    // 4. Build RouteStop array
    const routeStops: RouteStop[] = stopsResult.rows.map(row => ({
      id: row.id,
      address: row.address,
      latitude:  row.latitude  ? parseFloat(row.latitude)  : undefined,
      longitude: row.longitude ? parseFloat(row.longitude) : undefined,
      durationMinutes: row.duration_minutes ?? 30,
    }));

    // 5. Optimize
    const result = await optimizeRoute({ origin: originAddress || 'San Diego, CA', stops: routeStops, startTime }, maps);

    // 6. Persist route
    const routeRow = await dbQuery<{ id: string }>(
      `INSERT INTO showing_routes (
         showing_day_id, origin_address, total_distance_miles, total_duration_minutes,
         maps_url, waypoints, warnings
       ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb) RETURNING id`,
      [
        showingDayId, originAddress,
        result.totalDistanceMiles, result.totalDurationMinutes,
        result.mapsUrl,
        JSON.stringify(result.orderedStops),
        JSON.stringify(result.warnings),
      ],
    );
    const routeId = routeRow.rows[0]?.id ?? uuidv4();

    // 7. Update stop sequence order + scheduled times
    await Promise.allSettled(
      result.orderedStops.map(stop =>
        dbQuery(
          `UPDATE showing_day_properties
              SET sequence_order = $1, scheduled_time = $2
            WHERE id = $3`,
          [stop.sequenceOrder, stop.scheduledTime, stop.id],
        ),
      ),
    );

    // 8. Push WS event
    this.pushWsEvent('ROUTE_READY', request.correlationId, {
      showingDayId,
      routeId,
      mapsUrl: result.mapsUrl,
      totalDistanceMiles: result.totalDistanceMiles,
      totalDurationMinutes: result.totalDurationMinutes,
      warnings: result.warnings,
    });

    return this.successResult(request, {
      text: `Route optimized: ${result.orderedStops.length} stops, ${result.totalDistanceMiles} mi, ~${result.totalDurationMinutes} min total.`,
      showingDayId,
      routeId,
      mapsUrl: result.mapsUrl,
      warnings: result.warnings,
    }, { processingMs: Date.now() - start });
  }

  // ─── Capability: field_oracle ──────────────────────────────────────────────

  private async fieldOracle(request: TaskRequest, start: number): Promise<TaskResult> {
    const propertyResultId = String(request.data['propertyResultId'] ?? '');
    if (!propertyResultId) return this.failureResult(request, new Error('propertyResultId required'));

    // 1. Load property + check cache (2-hour TTL)
    const propRow = await dbQuery<PropertyResultRow>(
      `SELECT id, address, raw_listing, field_oracle_cache, oracle_cached_at,
              match_score, matched_criteria, missing_criteria
         FROM property_results WHERE id = $1`,
      [propertyResultId],
    );
    const prop = propRow.rows[0];
    if (!prop) return this.failureResult(request, new Error('Property not found'));

    const twoHoursAgo = new Date(Date.now() - 2 * 3600_000).toISOString();
    if (prop.field_oracle_cache && prop.oracle_cached_at && prop.oracle_cached_at > twoHoursAgo) {
      this.pushWsEvent('FIELD_ORACLE_READY', request.correlationId, {
        showingDayPropertyId: request.data['showingDayPropertyId'] as string ?? '',
        propertyAddress: prop.address,
        content: prop.field_oracle_cache,
        cached: true,
      });
      return this.successResult(request, {
        text: prop.field_oracle_cache,
        cached: true,
        propertyAddress: prop.address,
      }, { processingMs: Date.now() - start });
    }

    // 2. Generate dossier
    const rawListing = prop.raw_listing ? JSON.parse(prop.raw_listing) as Record<string, unknown> : {};
    const matchedCriteria: string[] = prop.matched_criteria ? JSON.parse(prop.matched_criteria) as string[] : [];
    const missingCriteria: string[] = prop.missing_criteria ? JSON.parse(prop.missing_criteria) as string[] : [];

    const prompt = `You are a real estate research assistant. Generate a concise field dossier for this property.

Property: ${prop.address}
Match score: ${prop.match_score ?? 'N/A'}/100
Matched criteria: ${matchedCriteria.join(', ') || 'none listed'}
Gaps: ${missingCriteria.join(', ') || 'none listed'}
MLS data: ${JSON.stringify(rawListing, null, 2).slice(0, 2000)}

Format your response as:
## Match Highlights
[2–3 bullets explaining why this property fits the buyer]

## Watch For
[1–2 bullets: potential concerns or questions to ask on-site]

## Quick Comps
[2–3 comparable sold prices with $/sqft, in the same neighborhood]

## Neighborhood
[1 paragraph: walkability, schools, commute, lifestyle appeal]`;

    const llmResponse = await this.callLlm(prompt, ModelTier.BALANCED);
    const content = llmResponse.text;

    // 3. Cache in DB
    await dbQuery(
      `UPDATE property_results SET field_oracle_cache = $1, oracle_cached_at = NOW() WHERE id = $2`,
      [content, propertyResultId],
    );

    // 4. Push WS event
    this.pushWsEvent('FIELD_ORACLE_READY', request.correlationId, {
      showingDayPropertyId: request.data['showingDayPropertyId'] as string ?? '',
      propertyAddress: prop.address,
      content,
      cached: false,
    });

    return this.successResult(request, {
      text: content,
      cached: false,
      propertyAddress: prop.address,
    }, { processingMs: Date.now() - start, llmResponse });
  }

  // ─── Capability: post_tour_report ──────────────────────────────────────────

  private async postTourReport(request: TaskRequest, start: number): Promise<TaskResult> {
    const showingDayId = String(request.data['showingDayId'] ?? '');
    if (!showingDayId) return this.failureResult(request, new Error('showingDayId required'));

    // 1. Load day info + contact
    const dayRow = await dbQuery<{ contact_id: string; proposed_date: string }>(
      `SELECT contact_id, proposed_date FROM showing_days WHERE id = $1`,
      [showingDayId],
    );
    const day = dayRow.rows[0];
    if (!day) return this.failureResult(request, new Error('Showing day not found'));

    // 2. Load notes + property scores
    const notesResult = await dbQuery<{
      note_text: string | null;
      voice_transcript: string | null;
      structured_reactions: string | null;
      address: string;
      match_score: number | null;
      matched_criteria: string | null;
      arrived_at: string | null;
      departed_at: string | null;
    }>(
      `SELECT sn.note_text, sn.voice_transcript, sn.structured_reactions,
              COALESCE(pr.address, sdp.address) AS address,
              pr.match_score,
              pr.matched_criteria,
              sdp.arrived_at,
              sdp.departed_at
         FROM showing_notes sn
         JOIN showing_day_properties sdp ON sn.showing_day_property_id = sdp.id
         LEFT JOIN property_results pr ON sdp.property_result_id = pr.id
        WHERE sdp.showing_day_id = $1
        ORDER BY sdp.sequence_order`,
      [showingDayId],
    );

    const notes = notesResult.rows;
    const tourDate = day.proposed_date;

    // 3. Generate agent report (blunt operational brief)
    const agentPrompt = `You are generating an internal agent briefing after a property showing day.

Tour date: ${tourDate}
Properties visited (${notes.length}):
${notes.map(n => `
Address: ${n.address}
Match score: ${n.match_score ?? 'N/A'}/100
Notes: ${n.note_text ?? n.voice_transcript ?? 'none'}
Reactions: ${n.structured_reactions ?? 'none'}`).join('\n---')}

Generate a concise agent brief:
1. FRONTRUNNER: Which property is the top candidate and why?
2. CRITERIA DRIFT: Did the buyer's stated preferences shift during the tour? What changed?
3. NEXT STEPS: Exactly 2–3 specific action items (e.g. "Schedule second showing at X", "Pull comps for Y", "Submit offer by Z").
4. OBJECTIONS TO ADDRESS: Key hesitations raised that need follow-up.

Be direct. No marketing language. This is for the agent's eyes only.`;

    const agentReport = await this.ask(agentPrompt, ModelTier.BALANCED);

    // 4. Generate client report (polished recap)
    const clientPrompt = `You are generating a post-tour summary email for a buyer client.

Tour date: ${tourDate}
Properties visited: ${notes.length}
Top properties by notes:
${notes.slice(0, 5).map(n => `- ${n.address}: ${n.note_text ?? n.voice_transcript ?? 'visited'}`).join('\n')}

Write a warm, enthusiastic summary that:
1. Thanks them for spending the day touring
2. Highlights the top 2–3 properties they seemed most excited about
3. Includes a gentle CTA: "Let me know which properties you'd like to revisit or if you're ready to make an offer on [top pick]."
4. Closes with next-steps warmth

Keep it under 200 words. First-person from the agent.`;

    const clientReport = await this.ask(clientPrompt, ModelTier.BALANCED);

    // 5. Persist reports
    await dbQuery(
      `INSERT INTO showing_reports (showing_day_id, report_type, content) VALUES ($1,'agent',$2),($1,'client',$3)`,
      [showingDayId, agentReport, clientReport],
    );

    // 6. Write tour reactions to contact memory profile
    const relAgent = this.agentRegistry?.get(AgentId.RELATIONSHIP);
    if (relAgent && day.contact_id && notes.some(n => n.structured_reactions)) {
      const reactionSummary = notes
        .filter(n => n.structured_reactions)
        .map(n => `${n.address}: ${n.structured_reactions}`)
        .join('\n');
      relAgent.handleTask({
        messageId: uuidv4(),
        timestamp: new Date().toISOString(),
        correlationId: uuidv4(),
        type: 'TASK_REQUEST',
        fromAgent: AgentId.COORDINATOR,
        toAgent: AgentId.RELATIONSHIP,
        priority: Priority.P3_BACKGROUND,
        taskType: 'update_contact',
        instructions: `Post-tour reactions (${tourDate}):\n${reactionSummary}`,
        context: { clientId: this.tenantId, contactId: day.contact_id },
        data: { contactId: day.contact_id },
        constraints: { maxTokens: 512, modelOverride: null, timeoutMs: 10_000, requiresApproval: false, approvalCategory: null },
      }).catch(() => {});
    }

    // 7. Queue client report for approval via COMMS (side effect)
    return this.successResult(request, {
      text: agentReport,
      agentReport,
      clientReportPreview: clientReport.slice(0, 300),
      showingDayId,
    }, {
      sideEffects: [{
        targetAgent: AgentId.COMMS,
        action: 'email_draft',
        data: { contactId: day.contact_id, body: clientReport, subject: `Your Home Tour Recap — ${tourDate}` },
      }],
      processingMs: Date.now() - start,
    });
  }

  // ─── Query handler ──────────────────────────────────────────────────────────

  async handleQuery(query: AgentQuery): Promise<QueryResponse> {
    return this.queryResponse(query, false, { error: `Unknown query type: ${query.queryType}` });
  }

  // ─── Briefing contribution ──────────────────────────────────────────────────

  async contributeToBriefing(_scope: string): Promise<BriefingSection> {
    try {
      const result = await dbQuery<{ count: string }>(
        `SELECT COUNT(*) AS count FROM showing_days
          WHERE tenant_id = $1 AND status IN ('confirmed','proposed_to_client')
            AND proposed_date >= CURRENT_DATE
            AND proposed_date <= CURRENT_DATE + INTERVAL '7 days'`,
        [this.tenantId],
      );
      const count = parseInt(result.rows[0]?.count ?? '0', 10);
      const content = count > 0
        ? `${count} showing day(s) scheduled in the next 7 days.`
        : 'No showing days scheduled in the next 7 days.';
      return { agentId: this.id, title: 'Showings', content, priority: 2 };
    } catch {
      return { agentId: this.id, title: 'Showings', content: 'Showings data unavailable.', priority: 3 };
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private async extractBuyerCriteria(contactId: string, fallbackInstructions: string): Promise<BuyerCriteria> {
    try {
      const mem = await this.readMemory({ path: `contacts/${contactId}.md` });
      if (mem.content) {
        const criteriaSection = mem.content.match(/##\s*Buying Criteria([\s\S]*?)(?=##|$)/i)?.[1] ?? '';
        if (criteriaSection.trim()) {
          const extracted = await this.ask(
            `Extract structured buying criteria from this profile section as JSON with these optional fields:
minPrice, maxPrice, minBeds, maxBeds, minBaths, city, zip, minSqft, maxSqft, pool (boolean), minGarageSpaces, propertySubTypes (array), maxDaysOnMarket.
Return ONLY valid JSON, no markdown.

Profile section:
${criteriaSection}`,
            ModelTier.FAST,
          );
          const match = extracted.match(/\{[\s\S]*\}/);
          if (match) return JSON.parse(match[0]) as BuyerCriteria;
        }
      }
    } catch { /* fall through */ }

    // Fallback: extract from free-text instructions
    if (fallbackInstructions.trim()) {
      try {
        const extracted = await this.ask(
          `Extract structured buying criteria from this text as JSON with fields: minPrice, maxPrice, minBeds, maxBeds, minBaths, city, zip, minSqft, maxSqft, pool, minGarageSpaces, propertySubTypes, maxDaysOnMarket. Return ONLY valid JSON.
Text: ${fallbackInstructions}`,
          ModelTier.FAST,
        );
        const match = extracted.match(/\{[\s\S]*\}/);
        if (match) return JSON.parse(match[0]) as BuyerCriteria;
      } catch { /* fall through */ }
    }

    return {}; // empty criteria — CRMLS will return active listings without price filter
  }

  private async batchScore(
    listings: Array<{ mlsNumber: string; address: string; price: number; beds: number; baths: number; sqft: number; pool?: boolean; garageSpaces?: number; yearBuilt: number; dom: number; city: string; zip: string }>,
    criteria: BuyerCriteria,
  ): Promise<Array<{ id: string; score: number; matchedCriteria: string[]; missingCriteria: string[]; compensatingFactors: string[] }>> {
    const prompt = `Score each real estate listing 0–100 against the buyer's criteria.

Buyer criteria: ${JSON.stringify(criteria)}

Listings:
${JSON.stringify(listings.map(l => ({
  id: l.mlsNumber,
  address: l.address,
  price: l.price,
  beds: l.beds,
  baths: l.baths,
  sqft: l.sqft,
  pool: l.pool,
  garageSpaces: l.garageSpaces,
  yearBuilt: l.yearBuilt,
  dom: l.dom,
  city: l.city,
  zip: l.zip,
})))}

Return ONLY valid JSON array (no markdown):
[{"id":"<listing_id>","score":0–100,"matchedCriteria":["..."],"missingCriteria":["..."],"compensatingFactors":["..."]}]

Scoring guide: 90–100 exceeds all criteria, 70–89 meets all key criteria, 50–69 most criteria met, 30–49 significant gaps, 0–29 poor match.`;

    try {
      const raw = await this.ask(prompt, ModelTier.FAST);
      const match = raw.match(/\[[\s\S]*\]/);
      if (match) return JSON.parse(match[0]) as ReturnType<typeof this.batchScore> extends Promise<infer T> ? T : never;
    } catch { /* fall through to defaults */ }

    // Default: 50 for all if LLM fails
    return listings.map(l => ({ id: l.mlsNumber, score: 50, matchedCriteria: [], missingCriteria: [], compensatingFactors: [] }));
  }

  private buildDayOptions(
    calendarSlots: Array<{ date: string; start: string; end: string }>,
    minBlockMinutes: number,
  ): Array<{ date: string; start: string; end: string }> {
    // Use calendar slots if available and sufficient
    const validSlots = calendarSlots.filter(s => {
      const startMs = new Date(`${s.date}T${s.start}`).getTime();
      const endMs   = new Date(`${s.date}T${s.end}`).getTime();
      return (endMs - startMs) / 60_000 >= minBlockMinutes;
    });

    if (validSlots.length >= 3) return validSlots.slice(0, 3);

    // Generate 3 weekday options starting from tomorrow
    const options: Array<{ date: string; start: string; end: string }> = [];
    const date = new Date();
    date.setDate(date.getDate() + 1);

    while (options.length < 3) {
      const dow = date.getDay();
      if (dow !== 0 && dow !== 6) { // skip Sunday (0) and Saturday (6)
        const dateStr = date.toISOString().slice(0, 10);
        const endHour = Math.min(9 + Math.ceil(minBlockMinutes / 60), 17);
        options.push({ date: dateStr, start: '09:00', end: `${String(endHour).padStart(2, '0')}:00` });
      }
      date.setDate(date.getDate() + 1);
    }
    return options;
  }

  private formatDayLabel(date: string, start: string, end: string): string {
    try {
      const d = new Date(`${date}T${start}`);
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const day = dayNames[d.getDay()];
      const mon = monthNames[d.getMonth()];
      const startHr = parseInt(start.split(':')[0]!, 10);
      const endHr   = parseInt(end.split(':')[0]!,   10);
      const startAmPm = startHr < 12 ? 'am' : 'pm';
      const endAmPm   = endHr   < 12 ? 'am' : 'pm';
      const startDisplay = startHr <= 12 ? startHr : startHr - 12;
      const endDisplay   = endHr   <= 12 ? endHr   : endHr   - 12;
      return `${day} ${mon} ${d.getDate()}, ${startDisplay}${startAmPm}–${endDisplay}${endAmPm}`;
    } catch {
      return `${date} ${start}–${end}`;
    }
  }

  // ─── Event-driven auto-dispatch ────────────────────────────────────────────

  private async dispatchPropertyMatch(contactId: string, correlationId?: string): Promise<void> {
    const syntheticRequest: TaskRequest = {
      messageId: uuidv4(),
      timestamp: new Date().toISOString(),
      correlationId: correlationId ?? uuidv4(),
      type: 'TASK_REQUEST',
      fromAgent: AgentId.COORDINATOR,
      toAgent: this.id,
      priority: 3, // P3_BACKGROUND
      taskType: 'property_match',
      instructions: '',
      context: { clientId: this.tenantId, contactId },
      data: { contactId },
      constraints: { maxTokens: 4000, modelOverride: null, timeoutMs: 60_000, requiresApproval: false, approvalCategory: null },
    };
    await this.handleTask(syntheticRequest).catch(err => {
      log.error('[ShowingsAgent] Auto property_match failed', { contactId, error: (err as Error).message });
    });
  }

  private async checkAndFireRouteOptimize(showingDayId: string): Promise<void> {
    try {
      const result = await dbQuery<{ count: string }>(
        `SELECT COUNT(*) AS count FROM showing_day_properties
          WHERE showing_day_id = $1
            AND access_status NOT IN ('confirmed','not_needed','failed')`,
        [showingDayId],
      );
      const pending = parseInt(result.rows[0]?.count ?? '1', 10);
      if (pending === 0) {
        const syntheticRequest: TaskRequest = {
          messageId: uuidv4(),
          timestamp: new Date().toISOString(),
          correlationId: uuidv4(),
          type: 'TASK_REQUEST',
          fromAgent: AgentId.COORDINATOR,
          toAgent: this.id,
          priority: 2, // P2_STANDARD
          taskType: 'route_optimize',
          instructions: '',
          context: { clientId: this.tenantId },
          data: { showingDayId },
          constraints: { maxTokens: 4000, modelOverride: null, timeoutMs: 90_000, requiresApproval: false, approvalCategory: null },
        };
        await this.handleTask(syntheticRequest).catch(err => {
          log.error('[ShowingsAgent] Auto route_optimize failed', { showingDayId, error: (err as Error).message });
        });
      }
    } catch (err) {
      log.error('[ShowingsAgent] checkAndFireRouteOptimize failed', { error: (err as Error).message });
    }
  }

  private async dispatchPostTourReport(showingDayId: string, correlationId?: string): Promise<void> {
    const syntheticRequest: TaskRequest = {
      messageId: uuidv4(),
      timestamp: new Date().toISOString(),
      correlationId: correlationId ?? uuidv4(),
      type: 'TASK_REQUEST',
      fromAgent: AgentId.COORDINATOR,
      toAgent: this.id,
      priority: 1, // P1_URGENT — same day
      taskType: 'post_tour_report',
      instructions: '',
      context: { clientId: this.tenantId },
      data: { showingDayId },
      constraints: { maxTokens: 8000, modelOverride: null, timeoutMs: 90_000, requiresApproval: false, approvalCategory: null },
    };
    await this.handleTask(syntheticRequest).catch(err => {
      log.error('[ShowingsAgent] Auto post_tour_report failed', { showingDayId, error: (err as Error).message });
    });
  }
}
