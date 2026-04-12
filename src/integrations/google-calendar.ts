import { BaseIntegration } from './base-integration.js';
import type { IntegrationStatus, NormalizedCalendarEvent } from '../types/integrations.js';
import { IntegrationId } from '../types/integrations.js';

export class GoogleCalendarIntegration extends BaseIntegration {
  async healthCheck(): Promise<IntegrationStatus> {
    const token = await this.vault.retrieve(IntegrationId.GOOGLE_CALENDAR, 'access_token');
    if (!token) return this.notConfigured();
    try {
      await this.authenticatedRequest('GET', '/calendar/v3/users/me/calendarList?maxResults=1');
      return this.connected();
    } catch {
      return { ...this.notConfigured(), status: 'disconnected' };
    }
  }

  async listEvents(
    calendarId = 'primary',
    timeMin?: string,
    timeMax?: string,
    maxResults = 50,
  ): Promise<NormalizedCalendarEvent[]> {
    const params = new URLSearchParams({
      maxResults: String(maxResults),
      singleEvents: 'true',
      orderBy: 'startTime',
      ...(timeMin ? { timeMin } : {}),
      ...(timeMax ? { timeMax } : {}),
    });

    const data = await this.authenticatedRequest(
      'GET',
      `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
    ) as { items?: GoogleCalendarEvent[] };

    return (data.items ?? []).map(e => this.normalize(e));
  }

  async createEvent(
    event: Partial<NormalizedCalendarEvent>,
    calendarId = 'primary',
  ): Promise<NormalizedCalendarEvent> {
    const body = {
      summary: event.title,
      location: event.location,
      description: event.description,
      start: event.isAllDay
        ? { date: event.start?.slice(0, 10) }
        : { dateTime: event.start, timeZone: 'America/Los_Angeles' },
      end: event.isAllDay
        ? { date: event.end?.slice(0, 10) }
        : { dateTime: event.end, timeZone: 'America/Los_Angeles' },
      attendees: (event.attendees ?? []).map(a => ({ email: a.email, displayName: a.name })),
    };

    const data = await this.authenticatedRequest(
      'POST',
      `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
      body,
    ) as GoogleCalendarEvent;

    return this.normalize(data);
  }

  async updateEvent(
    eventId: string,
    updates: Partial<NormalizedCalendarEvent>,
    calendarId = 'primary',
  ): Promise<NormalizedCalendarEvent> {
    const body: Record<string, unknown> = {};
    if (updates.title) body['summary'] = updates.title;
    if (updates.start) body['start'] = { dateTime: updates.start };
    if (updates.end) body['end'] = { dateTime: updates.end };
    if (updates.location !== undefined) body['location'] = updates.location;

    const data = await this.authenticatedRequest(
      'PATCH',
      `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`,
      body,
    ) as GoogleCalendarEvent;

    return this.normalize(data);
  }

  async deleteEvent(eventId: string, calendarId = 'primary'): Promise<void> {
    await this.authenticatedRequest(
      'DELETE',
      `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`,
    );
  }

  async checkAvailability(
    emails: string[],
    timeMin: string,
    timeMax: string,
  ): Promise<Record<string, boolean>> {
    const data = await this.authenticatedRequest('POST', '/calendar/v3/freeBusy', {
      timeMin,
      timeMax,
      items: emails.map(email => ({ id: email })),
    }) as { calendars?: Record<string, { busy?: { start: string; end: string }[] }> };

    const result: Record<string, boolean> = {};
    for (const email of emails) {
      const busy = data.calendars?.[email]?.busy ?? [];
      result[email] = busy.length === 0;
    }
    return result;
  }

  private normalize(e: GoogleCalendarEvent): NormalizedCalendarEvent {
    const isAllDay = !!e.start?.date;
    return {
      eventId: e.id ?? '',
      title: e.summary ?? '',
      start: e.start?.dateTime ?? e.start?.date ?? '',
      end: e.end?.dateTime ?? e.end?.date ?? '',
      location: e.location ?? null,
      description: e.description ?? null,
      attendees: (e.attendees ?? []).map(a => ({
        name: a.displayName ?? '',
        email: a.email ?? '',
        status: (a.responseStatus ?? 'needs_action') as NormalizedCalendarEvent['attendees'][0]['status'],
      })),
      reminders: [],
      source: e.source?.title === 'Claw' ? 'claw_created' : 'external',
      isAllDay,
      recurrence: e.recurrence?.[0] ?? null,
    };
  }
}

// ─── Google Calendar API Types ───

interface GoogleCalendarEvent {
  id?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { email?: string; displayName?: string; responseStatus?: string }[];
  recurrence?: string[];
  source?: { title?: string; url?: string };
}
