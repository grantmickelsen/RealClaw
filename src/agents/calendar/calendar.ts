import { BaseAgent } from '../base-agent.js';
import { ModelTier } from '../../types/agents.js';
import { IntegrationId } from '../../types/integrations.js';
import type { TaskRequest, TaskResult, AgentQuery, QueryResponse, BriefingSection } from '../../types/messages.js';
import type { GoogleCalendarIntegration } from '../../integrations/google-calendar.js';
import type { NormalizedCalendarEvent } from '../../types/integrations.js';

const NOT_CONNECTED = 'Google Calendar not connected. Run `npm run setup` to connect.';

export class CalendarAgent extends BaseAgent {
  async handleTask(request: TaskRequest): Promise<TaskResult> {
    const start = Date.now();
    try {
      switch (request.taskType) {
        case 'schedule_event':
        case 'schedule_': {
          const gcal = this.getIntegration<GoogleCalendarIntegration>(IntegrationId.GOOGLE_CALENDAR);
          if (!gcal) {
            return this.successResult(request, { text: NOT_CONNECTED }, { processingMs: Date.now() - start });
          }

          // Parse scheduling details from natural language
          const detailsJson = await this.ask(
            `Parse this scheduling request and return JSON with fields: title, startIso (ISO-8601), endIso (ISO-8601), attendeeEmails (array of strings), location (string or null), description (string or null).\n\nRequest: ${request.instructions}`,
            ModelTier.FAST,
          );

          let parsed: Partial<NormalizedCalendarEvent> = {};
          try {
            const raw = JSON.parse(detailsJson.match(/\{[\s\S]*\}/)?.[0] ?? '{}') as Record<string, unknown>;
            parsed = {
              title: String(raw['title'] ?? request.instructions),
              start: String(raw['startIso'] ?? ''),
              end: String(raw['endIso'] ?? ''),
              location: raw['location'] ? String(raw['location']) : null,
              description: raw['description'] ? String(raw['description']) : null,
              attendees: (Array.isArray(raw['attendeeEmails']) ? raw['attendeeEmails'] as string[] : [])
                .map(email => ({ name: '', email, status: 'needs_action' as const })),
              isAllDay: false,
            };
          } catch {
            parsed = { title: request.instructions };
          }

          return this.successResult(request, {
            text: `Ready to schedule: ${parsed.title ?? request.instructions}`,
            parsedDetails: parsed,
          }, {
            approval: {
              actionType: 'modify_calendar',
              preview: `Schedule "${parsed.title}" on ${parsed.start ?? 'TBD'}`,
              recipients: (parsed.attendees ?? []).map(a => a.email),
            },
            processingMs: Date.now() - start,
          });
        }

        case 'whats_my_schedule': {
          const gcal = this.getIntegration<GoogleCalendarIntegration>(IntegrationId.GOOGLE_CALENDAR);
          if (!gcal) {
            return this.successResult(request, { text: NOT_CONNECTED }, { processingMs: Date.now() - start });
          }

          const todayStart = new Date();
          todayStart.setHours(0, 0, 0, 0);
          const todayEnd = new Date();
          todayEnd.setHours(23, 59, 59, 999);

          const events = await gcal.listEvents('primary', todayStart.toISOString(), todayEnd.toISOString());
          const summary = await this.ask(
            `Summarize today's schedule for a real estate agent in a friendly, concise way.\n\nEvents (${events.length}):\n${JSON.stringify(events, null, 2)}`,
            ModelTier.FAST,
          );
          return this.successResult(request, { text: summary, events }, { processingMs: Date.now() - start });
        }

        case 'briefing_generate': {
          const gcal = this.getIntegration<GoogleCalendarIntegration>(IntegrationId.GOOGLE_CALENDAR);
          if (!gcal) {
            return this.successResult(request, {
              text: `${request.data['type'] ?? 'Briefing'}: ${NOT_CONNECTED}`,
            }, { processingMs: Date.now() - start });
          }

          const tomorrowStart = new Date(Date.now() + 86_400_000);
          tomorrowStart.setHours(0, 0, 0, 0);
          const tomorrowEnd = new Date(tomorrowStart.getTime() + 86_399_999);

          const events = await gcal.listEvents('primary', tomorrowStart.toISOString(), tomorrowEnd.toISOString());
          const type = String(request.data['type'] ?? 'morning_briefing');
          const briefing = await this.ask(
            `Create a ${type} for a real estate agent. Include prep reminders and conflict flags.\n\nTomorrow's events (${events.length}):\n${JSON.stringify(events, null, 2)}`,
            ModelTier.FAST,
          );
          return this.successResult(request, { text: briefing, events }, { processingMs: Date.now() - start });
        }

        case 'showing_coordinate':
        case 'showing_coordinator': {
          const gcal = this.getIntegration<GoogleCalendarIntegration>(IntegrationId.GOOGLE_CALENDAR);
          const showing = await this.ask(
            `Create a showing coordination plan for: ${request.instructions}\n\nInclude: confirmation email draft, 30-min travel buffer before/after, prep checklist.`,
            ModelTier.BALANCED,
          );

          if (gcal) {
            this.emitEvent('calendar.event_added', { type: 'showing', details: request.instructions });
          }

          return this.successResult(request, { text: showing }, { processingMs: Date.now() - start });
        }

        case 'heartbeat': {
          const gcal = this.getIntegration<GoogleCalendarIntegration>(IntegrationId.GOOGLE_CALENDAR);
          let upcomingEvents: NormalizedCalendarEvent[] = [];
          if (gcal) {
            const now = new Date().toISOString();
            const horizon = new Date(Date.now() + 2 * 3_600_000).toISOString(); // next 2 hours
            upcomingEvents = await gcal.listEvents('primary', now, horizon).catch(() => []);
          }
          return this.successResult(request, { status: 'ready', upcomingEvents }, { processingMs: Date.now() - start });
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
    if (query.queryType === 'schedule_check') {
      const gcal = this.getIntegration<GoogleCalendarIntegration>(IntegrationId.GOOGLE_CALENDAR);
      if (!gcal) {
        return this.queryResponse(query, true, {
          available: null,
          message: NOT_CONNECTED,
        });
      }

      const emails = (query.parameters['emails'] as string[] | undefined) ?? [];
      const timeMin = String(query.parameters['timeMin'] ?? new Date().toISOString());
      const timeMax = String(query.parameters['timeMax'] ?? new Date(Date.now() + 3_600_000).toISOString());

      const availability = await gcal.checkAvailability(emails, timeMin, timeMax);
      const allAvailable = Object.values(availability).every(Boolean);

      return this.queryResponse(query, true, {
        available: allAvailable,
        availability,
        timeMin,
        timeMax,
      });
    }
    return this.queryResponse(query, false, { error: `Unknown query: ${query.queryType}` });
  }

  async contributeToBriefing(_scope: string): Promise<BriefingSection> {
    const gcal = this.getIntegration<GoogleCalendarIntegration>(IntegrationId.GOOGLE_CALENDAR);
    if (!gcal) {
      return {
        agentId: this.id,
        title: "Today's Schedule",
        content: NOT_CONNECTED,
        priority: 1,
      };
    }

    try {
      const now = new Date();
      const endOfTomorrow = new Date(now.getTime() + 2 * 86_400_000);
      const events = await gcal.listEvents('primary', now.toISOString(), endOfTomorrow.toISOString(), 10);

      if (events.length === 0) {
        return {
          agentId: this.id,
          title: "Today's Schedule",
          content: 'No events in the next 48 hours.',
          priority: 1,
        };
      }

      const lines = events.map(e => `- ${e.title} (${e.start})`).join('\n');
      return {
        agentId: this.id,
        title: "Today's Schedule",
        content: `${events.length} event(s) in the next 48 hours:\n${lines}`,
        priority: 1,
      };
    } catch {
      return {
        agentId: this.id,
        title: "Today's Schedule",
        content: 'Calendar data temporarily unavailable.',
        priority: 1,
      };
    }
  }
}
