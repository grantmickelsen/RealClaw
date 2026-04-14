import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HeartbeatScheduler } from '../../../../src/agents/ops/heartbeat.js';
import type { HeartbeatTrigger } from '../../../../src/types/messages.js';

// Mock node-cron to prevent actual scheduling
const scheduledTasks = new Map<string, { running: boolean; destroy: () => void }>();

vi.mock('node-cron', () => ({
  default: {
    schedule: vi.fn().mockImplementation((_cron: string, cb: () => void, _opts: unknown) => {
      return { running: true, stop: vi.fn(), _cb: cb };
    }),
    validate: vi.fn().mockReturnValue(true),
  },
  schedule: vi.fn().mockImplementation((_cron: string, cb: () => void, _opts: unknown) => {
    return { running: true, stop: vi.fn(), _cb: cb };
  }),
  validate: vi.fn().mockReturnValue(true),
}));

import cron from 'node-cron';

describe('HeartbeatScheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset validate to return true by default
    vi.mocked(cron.validate).mockReturnValue(true);
  });

  it('load() schedules enabled cron tasks', () => {
    const scheduler = new HeartbeatScheduler();
    scheduler.load({
      schedules: [
        { name: 'morning_briefing', cron: '0 7 * * *', targets: 'all', parameters: {}, enabled: true },
        { name: 'eod_summary', cron: '0 17 * * *', targets: 'all', parameters: {}, enabled: true },
      ],
      timezone: 'America/Los_Angeles',
    });
    expect(cron.schedule).toHaveBeenCalledTimes(2);
  });

  it('load() skips schedules with enabled:false', () => {
    const scheduler = new HeartbeatScheduler();
    scheduler.load({
      schedules: [
        { name: 'active', cron: '0 7 * * *', targets: 'all', parameters: {}, enabled: true },
        { name: 'disabled', cron: '0 8 * * *', targets: 'all', parameters: {}, enabled: false },
      ],
      timezone: 'UTC',
    });
    expect(cron.schedule).toHaveBeenCalledTimes(1);
  });

  it('load() logs error and skips invalid cron expressions', () => {
    vi.mocked(cron.validate).mockReturnValueOnce(false);
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const scheduler = new HeartbeatScheduler();
    scheduler.load({
      schedules: [
        { name: 'invalid', cron: 'NOT_A_CRON', targets: 'all', parameters: {} },
      ],
      timezone: 'UTC',
    });
    expect(cron.schedule).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('onTrigger() handler is called when cron fires', async () => {
    let capturedCb: (() => void) | null = null;
    vi.mocked(cron.schedule).mockImplementationOnce((_cron, cb) => {
      capturedCb = cb;
      return { destroy: vi.fn(), running: true } as never;
    });

    const scheduler = new HeartbeatScheduler();
    const triggerHandler = vi.fn();
    scheduler.onTrigger(triggerHandler);

    scheduler.load({
      schedules: [{ name: 'test_trigger', cron: '0 7 * * *', targets: 'all', parameters: { key: 'val' } }],
      timezone: 'UTC',
    });

    expect(capturedCb).not.toBeNull();
    capturedCb!();

    // Handler is called via setImmediate or synchronously — give event loop a tick
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(triggerHandler).toHaveBeenCalledOnce();

    const trigger = triggerHandler.mock.calls[0][0] as HeartbeatTrigger;
    expect(trigger.type).toBe('HEARTBEAT_TRIGGER');
    expect(trigger.triggerName).toBe('test_trigger');
    expect(trigger.parameters).toEqual({ key: 'val' });
  });

  it('stop() calls stop() on all scheduled tasks', () => {
    const stopFns: ReturnType<typeof vi.fn>[] = [];
    vi.mocked(cron.schedule).mockImplementation(() => {
      const stopFn = vi.fn();
      stopFns.push(stopFn);
      return { stop: stopFn, running: true } as never;
    });

    const scheduler = new HeartbeatScheduler();
    scheduler.load({
      schedules: [
        { name: 'task1', cron: '0 7 * * *', targets: 'all', parameters: {} },
        { name: 'task2', cron: '0 8 * * *', targets: 'all', parameters: {} },
      ],
      timezone: 'UTC',
    });

    scheduler.stop();
    expect(stopFns).toHaveLength(2);
    for (const stopFn of stopFns) {
      expect(stopFn).toHaveBeenCalledOnce();
    }
  });

  it('listScheduled() returns names of loaded schedules', () => {
    const scheduler = new HeartbeatScheduler();
    scheduler.load({
      schedules: [
        { name: 'morning_briefing', cron: '0 7 * * *', targets: 'all', parameters: {} },
        { name: 'eod_summary', cron: '0 17 * * *', targets: 'all', parameters: {} },
      ],
      timezone: 'UTC',
    });
    const names = scheduler.listScheduled();
    expect(names).toContain('morning_briefing');
    expect(names).toContain('eod_summary');
    expect(names).toHaveLength(2);
  });
});
