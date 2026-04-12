import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CalendarAgent } from '../../../src/agents/calendar/calendar.js';
import { IntegrationId } from '../../../src/types/integrations.js';
import { AgentId, ModelTier } from '../../../src/types/agents.js';
import type { TaskRequest, AgentQuery } from '../../../src/types/messages.js';
import type { NormalizedCalendarEvent } from '../../../src/types/integrations.js';

// ─── Minimal stubs ───

const mockLlmRouter = {
  complete: vi.fn().mockResolvedValue({
    text: 'LLM response text',
    inputTokens: 10,
    outputTokens: 20,
    model: 'test-model',
    provider: 'anthropic',
    latencyMs: 100,
    estimatedCostUsd: 0.001,
  }),
};

const mockMemory = {
  read: vi.fn().mockResolvedValue({ found: false, entries: [] }),
  write: vi.fn().mockResolvedValue({ success: true, path: '', operation: 'create', newSize: 0 }),
};

const mockEventBus = {
  subscribe: vi.fn(),
  emit: vi.fn(),
};

const mockAuditLogger = { log: vi.fn() };

const mockConfig = {
  id: AgentId.CALENDAR,
  displayName: 'Calendar Agent',
  soulMdPath: '/nonexistent/SOUL.md',
  defaultModel: ModelTier.FAST,
  subscribesTo: [],
  queryTargets: [],
  writeTargets: [] as never[],
};

const sampleEvent: NormalizedCalendarEvent = {
  eventId: 'evt-001',
  title: 'Client Meeting',
  start: '2026-04-12T10:00:00-07:00',
  end: '2026-04-12T11:00:00-07:00',
  location: '123 Main St',
  description: null,
  attendees: [],
  reminders: [],
  source: 'external',
  isAllDay: false,
  recurrence: null,
};

function makeRequest(overrides: Partial<TaskRequest> = {}): TaskRequest {
  return {
    messageId: 'msg-001',
    timestamp: new Date().toISOString(),
    correlationId: 'corr-001',
    type: 'TASK_REQUEST',
    fromAgent: 'coordinator' as AgentId,
    toAgent: AgentId.CALENDAR,
    taskType: 'whats_my_schedule',
    instructions: 'What is on my calendar today?',
    data: {},
    constraints: { modelOverride: null, maxTokens: 4096, timeoutMs: 30000 },
    priority: 2,
    ...overrides,
  };
}

function makeAgent(): CalendarAgent {
  return new CalendarAgent(
    mockConfig as never,
    mockLlmRouter as never,
    mockMemory as never,
    mockEventBus as never,
    mockAuditLogger as never,
  );
}

describe('CalendarAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns NOT_CONNECTED fallback when integration is null', async () => {
    const agent = makeAgent();
    // No integration manager set — getIntegration returns null
    const result = await agent.handleTask(makeRequest({ taskType: 'whats_my_schedule' }));
    expect(result.status).toBe('success');
    expect(String(result.result['text'])).toContain('not connected');
  });

  it('calls listEvents with today date range for whats_my_schedule', async () => {
    const agent = makeAgent();
    const mockGcal = {
      listEvents: vi.fn().mockResolvedValue([sampleEvent]),
      createEvent: vi.fn(),
      checkAvailability: vi.fn(),
    };

    vi.spyOn(agent as never, 'getIntegration').mockReturnValue(mockGcal);

    const result = await agent.handleTask(makeRequest({ taskType: 'whats_my_schedule' }));

    expect(mockGcal.listEvents).toHaveBeenCalledOnce();
    const [, timeMin, timeMax] = mockGcal.listEvents.mock.calls[0] as [string, string, string];
    // timeMin should be start of today
    expect(new Date(timeMin).getHours()).toBe(0);
    // timeMax should be end of today
    expect(new Date(timeMax).getHours()).toBe(23);
    expect(result.status).toBe('success');
    expect(result.result['events']).toHaveLength(1);
  });

  it('calls listEvents with tomorrow date range for briefing_generate', async () => {
    const agent = makeAgent();
    const mockGcal = {
      listEvents: vi.fn().mockResolvedValue([sampleEvent]),
    };
    vi.spyOn(agent as never, 'getIntegration').mockReturnValue(mockGcal);

    await agent.handleTask(makeRequest({
      taskType: 'briefing_generate',
      data: { type: 'morning_briefing' },
    }));

    expect(mockGcal.listEvents).toHaveBeenCalledOnce();
    const [, timeMin] = mockGcal.listEvents.mock.calls[0] as [string, string, string];
    // timeMin should be start of tomorrow (at least 12h from now)
    const tomorrow = new Date(Date.now() + 86_400_000);
    expect(new Date(timeMin).getDate()).toBe(tomorrow.getDate());
  });

  it('schedule_check query calls checkAvailability with correct params', async () => {
    const agent = makeAgent();
    const mockGcal = {
      checkAvailability: vi.fn().mockResolvedValue({ 'client@example.com': true }),
    };
    vi.spyOn(agent as never, 'getIntegration').mockReturnValue(mockGcal);

    const query: AgentQuery = {
      messageId: 'q-001',
      timestamp: new Date().toISOString(),
      correlationId: 'corr-001',
      type: 'AGENT_QUERY',
      fromAgent: AgentId.COMMS,
      toAgent: AgentId.CALENDAR,
      queryType: 'schedule_check',
      parameters: {
        emails: ['client@example.com'],
        timeMin: '2026-04-12T10:00:00Z',
        timeMax: '2026-04-12T11:00:00Z',
      },
    };

    const response = await agent.handleQuery(query);
    expect(mockGcal.checkAvailability).toHaveBeenCalledWith(
      ['client@example.com'],
      '2026-04-12T10:00:00Z',
      '2026-04-12T11:00:00Z',
    );
    expect(response.found).toBe(true);
    expect(response.data['available']).toBe(true);
  });

  it('schedule_check query returns null available when integration not connected', async () => {
    const agent = makeAgent();
    // No integration manager

    const query: AgentQuery = {
      messageId: 'q-002',
      timestamp: new Date().toISOString(),
      correlationId: 'corr-001',
      type: 'AGENT_QUERY',
      fromAgent: AgentId.COMMS,
      toAgent: AgentId.CALENDAR,
      queryType: 'schedule_check',
      parameters: {},
    };

    const response = await agent.handleQuery(query);
    expect(response.data['available']).toBeNull();
    expect(String(response.data['message'])).toContain('not connected');
  });

  it('contributeToBriefing returns real event list when integration connected', async () => {
    const agent = makeAgent();
    const mockGcal = {
      listEvents: vi.fn().mockResolvedValue([sampleEvent]),
    };
    vi.spyOn(agent as never, 'getIntegration').mockReturnValue(mockGcal);

    const section = await agent.contributeToBriefing('morning');
    expect(section.content).toContain('Client Meeting');
    expect(mockGcal.listEvents).toHaveBeenCalledOnce();
  });

  it('contributeToBriefing returns NOT_CONNECTED when integration is null', async () => {
    const agent = makeAgent();
    const section = await agent.contributeToBriefing('morning');
    expect(section.content).toContain('not connected');
  });

  it('schedule_event returns approval task when integration connected', async () => {
    const agent = makeAgent();
    const mockGcal = {
      createEvent: vi.fn().mockResolvedValue(sampleEvent),
    };
    vi.spyOn(agent as never, 'getIntegration').mockReturnValue(mockGcal);
    mockLlmRouter.complete.mockResolvedValueOnce({
      text: '{"title":"Client Showing","startIso":"2026-04-12T10:00:00-07:00","endIso":"2026-04-12T11:00:00-07:00","attendeeEmails":[],"location":null,"description":null}',
      inputTokens: 10, outputTokens: 20, model: 'test', provider: 'anthropic', latencyMs: 100, estimatedCostUsd: 0,
    });

    const result = await agent.handleTask(makeRequest({
      taskType: 'schedule_event',
      instructions: 'Schedule a showing for 123 Main St tomorrow at 10am',
    }));

    expect(result.status).toBe('needs_approval');
    expect(result.approval?.actionType).toBe('modify_calendar');
  });
});
