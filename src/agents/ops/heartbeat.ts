import cron from 'node-cron';
import { v4 as uuidv4 } from 'uuid';
import type { HeartbeatTrigger } from '../../types/messages.js';
import type { AgentId } from '../../types/agents.js';

interface HeartbeatSchedule {
  name: string;
  cron: string;
  targets: AgentId[] | 'all';
  parameters: Record<string, unknown>;
  enabled?: boolean;
}

interface HeartbeatConfig {
  schedules: HeartbeatSchedule[];
  timezone: string;
}

type TriggerHandler = (trigger: HeartbeatTrigger) => Promise<void>;

export class HeartbeatScheduler {
  private readonly tasks = new Map<string, cron.ScheduledTask>();
  private handler?: TriggerHandler;

  onTrigger(handler: TriggerHandler): void {
    this.handler = handler;
  }

  load(config: HeartbeatConfig): void {
    this.stop();

    for (const schedule of config.schedules) {
      if (schedule.enabled === false) continue;

      if (!cron.validate(schedule.cron)) {
        console.warn(`[Heartbeat] Invalid cron expression for "${schedule.name}": ${schedule.cron}`);
        continue;
      }

      const task = cron.schedule(
        schedule.cron,
        async () => {
          if (!this.handler) return;
          const trigger: HeartbeatTrigger = {
            messageId: uuidv4(),
            timestamp: new Date().toISOString(),
            correlationId: uuidv4(),
            type: 'HEARTBEAT_TRIGGER',
            triggerName: schedule.name,
            targetAgents: schedule.targets,
            parameters: schedule.parameters,
          };
          try {
            await this.handler(trigger);
          } catch (err) {
            console.error(`[Heartbeat] Trigger "${schedule.name}" failed:`, err);
          }
        },
        {
          timezone: config.timezone,
          scheduled: true,
        },
      );

      this.tasks.set(schedule.name, task);
      console.log(`[Heartbeat] Scheduled "${schedule.name}" at "${schedule.cron}" (${config.timezone})`);
    }
  }

  stop(): void {
    for (const [name, task] of this.tasks) {
      task.stop();
      this.tasks.delete(name);
    }
  }

  listScheduled(): string[] {
    return [...this.tasks.keys()];
  }
}
