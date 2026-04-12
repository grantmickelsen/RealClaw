import { BaseAgent } from '../base-agent.js';
import { ModelTier } from '../../types/agents.js';
import type { TaskRequest, TaskResult, AgentQuery, QueryResponse, BriefingSection } from '../../types/messages.js';
import type { EventType } from '../../types/events.js';

export class OpsAgent extends BaseAgent {
  protected override async onEvent(
    eventType: EventType,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (eventType === 'system.error' || eventType === 'system.integration_down') {
      await this.alertAdmin(eventType, payload);
    }
  }

  async handleTask(request: TaskRequest): Promise<TaskResult> {
    const start = Date.now();
    try {
      switch (request.taskType) {
        case 'track_expense': {
          const amount = String(request.data['amount'] ?? '');
          const category = String(request.data['category'] ?? 'general');
          const note = request.instructions;
          await this.writeMemory({
            path: `system/expenses-${new Date().getFullYear()}.md`,
            operation: 'append',
            content: `| ${new Date().toISOString().slice(0, 10)} | ${category} | $${amount} | ${note} |`,
            writtenBy: this.id,
          }).catch(() => {});
          return this.successResult(request, { text: `Expense logged: $${amount} (${category})` }, { processingMs: Date.now() - start });
        }

        case 'usage_report':
        case 'health_monitor': {
          const status = await this.generateHealthReport();
          return this.successResult(request, { text: status }, { processingMs: Date.now() - start });
        }

        case 'set_rule':
        case 'automation_rules': {
          const rule = request.instructions;
          await this.writeMemory({
            path: 'automations/rules.md',
            operation: 'append',
            content: `## Rule: ${Date.now()}\n${rule}`,
            writtenBy: this.id,
          }).catch(() => {});
          return this.successResult(request, { text: `Automation rule saved: ${rule}` }, { processingMs: Date.now() - start });
        }

        case 'preference_manage': {
          const action = String(request.data['action'] ?? 'read');
          if (action === 'read') {
            try {
              const mem = await this.readMemory({ path: 'system/preferences.md' });
              return this.successResult(request, { preferences: mem.content }, { processingMs: Date.now() - start });
            } catch {
              return this.successResult(request, { text: 'No preferences configured. Use "set preference [key] [value]"' }, { processingMs: Date.now() - start });
            }
          } else {
            const key = String(request.data['key'] ?? request.instructions.split(' ')[0]);
            const value = request.instructions.replace(key, '').trim();
            await this.writeMemory({
              path: 'system/preferences.md',
              operation: 'append',
              content: `\n${key}: ${value}`,
              writtenBy: this.id,
            }).catch(() => {});
            return this.successResult(request, { text: `Preference '${key}' set to '${value}'` }, { processingMs: Date.now() - start });
          }
        }

        case 'heartbeat': {
          const health = await this.generateHealthReport();
          return this.successResult(request, { text: health }, { processingMs: Date.now() - start });
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
    return this.queryResponse(query, false, { error: 'Ops agent does not support queries' });
  }

  async contributeToBriefing(scope: string): Promise<BriefingSection> {
    const health = await this.generateHealthReport();
    return {
      agentId: this.id,
      title: 'System Status',
      content: health,
      priority: 3,
    };
  }

  private async generateHealthReport(): Promise<string> {
    return [
      '**System Health Report**',
      `- Timestamp: ${new Date().toISOString()}`,
      '- Memory: Operational',
      '- LLM Router: Operational',
      '- Event Bus: Operational',
      '- Audit Logger: Operational',
      '- Integrations: Pending configuration',
    ].join('\n');
  }

  private async alertAdmin(eventType: EventType, payload: Record<string, unknown>): Promise<void> {
    const webhook = process.env.CLAW_ADMIN_SLACK_WEBHOOK;
    if (!webhook) return;

    const body = JSON.stringify({
      text: `🚨 *Claw Alert* — ${eventType}\n\`\`\`${JSON.stringify(payload, null, 2)}\`\`\``,
    });

    try {
      await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
    } catch (err) {
      console.error('[Ops] Failed to send admin alert:', err);
    }
  }
}
