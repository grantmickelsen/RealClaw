import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import { AgentId, AGENT_CONFIGS, Priority, ModelTier } from '../types/agents.js';
import type {
  InboundMessage,
  TaskRequest,
  TaskResult,
  ApprovalResponse,
  OutboundMessage,
  HeartbeatTrigger,
} from '../types/messages.js';
import { sanitize } from '../middleware/input-sanitizer.js';
import { CoordinatorRouter } from './router.js';
import { Dispatcher } from './dispatcher.js';
import { Synthesizer } from './synthesizer.js';
import { ApprovalManager } from './approval.js';
import type { LlmRouter } from '../llm/router.js';
import type { AuditLogger } from '../middleware/audit-logger.js';
import type { EventBus } from '../agents/ops/event-bus.js';
import { formatOutbound } from '../utils/normalize.js';

interface ClientConfig {
  clientId: string;
  clientName: string;
  primaryPlatform: string;
  platformChannelId: string;
  tier: string;
}

export class Coordinator {
  private readonly agentId = AgentId.COORDINATOR;
  private clientConfig: ClientConfig | null = null;
  private soulPrompt = '';

  private readonly clawRouter: CoordinatorRouter;
  private readonly dispatcher: Dispatcher;
  private readonly synthesizer: Synthesizer;
  private readonly approvalManager: ApprovalManager;

  // Outbound message callback (set by gateway)
  private sendMessage?: (platform: string, channelId: string, payload: unknown) => Promise<void>;

  constructor(
    private readonly llmRouter: LlmRouter,
    private readonly auditLogger: AuditLogger,
    private readonly eventBus: EventBus,
  ) {
    this.clawRouter = new CoordinatorRouter(llmRouter, this.agentId);
    this.dispatcher = new Dispatcher();
    this.synthesizer = new Synthesizer(llmRouter, this.agentId);
    this.approvalManager = new ApprovalManager();

    this.approvalManager.onExecute(async (request, response) => {
      const approvedDecisions = response.decisions.filter(d => d.decision === 'approve');

      for (const decision of approvedDecisions) {
        const item = request.batch[decision.index];
        if (!item) continue;

        const taskRequest: TaskRequest = {
          messageId: uuidv4(),
          timestamp: new Date().toISOString(),
          correlationId: request.correlationId,
          type: 'TASK_REQUEST',
          fromAgent: this.agentId,
          toAgent: item.originatingAgent,
          priority: Priority.P1_URGENT,
          taskType: 'send_message',
          instructions: item.fullContent ?? item.preview,
          context: {
            clientId: this.clientConfig?.clientId ?? 'default',
            contactId: item.recipients[0],
          },
          data: {
            medium: item.medium,
            recipients: item.recipients,
            approved: true,
            approvalId: request.approvalId,
            taskResultId: item.taskResultId,
          },
          constraints: {
            maxTokens: 4096,
            modelOverride: null,
            timeoutMs: 30_000,
            requiresApproval: false,
            approvalCategory: null,
          },
        };

        await this.dispatcher.dispatchSingle(item.originatingAgent, taskRequest).catch(err => {
          console.error('[Coordinator] Failed to execute approved action:', err);
        });
      }
    });
  }

  async init(configDir: string): Promise<void> {
    // Load SOUL.md
    try {
      this.soulPrompt = await fs.readFile('./src/coordinator/SOUL.md', 'utf-8');
    } catch {
      this.soulPrompt = 'You are Claw, a professional real estate executive assistant.';
    }

    // Load client config
    try {
      const raw = await fs.readFile(`${configDir}/client.json`, 'utf-8');
      this.clientConfig = JSON.parse(raw) as ClientConfig;
    } catch {
      console.warn('[Coordinator] No client.json found');
    }

    // Load agents config for routing
    try {
      const raw = await fs.readFile(`${configDir}/agents.json`, 'utf-8');
      const agentsConfig = JSON.parse(raw);
      this.clawRouter.setConfig(agentsConfig);
    } catch {
      console.warn('[Coordinator] No agents.json found');
    }

    // Load approval config
    try {
      const raw = await fs.readFile(`${configDir}/approval-gates.json`, 'utf-8');
      const approvalConfig = JSON.parse(raw);
      // Config is passed to ApprovalManager during construction
      void approvalConfig;
    } catch {
      console.warn('[Coordinator] No approval-gates.json found');
    }

    await this.approvalManager.loadFromDisk();
  }

  onSendMessage(
    callback: (platform: string, channelId: string, payload: unknown) => Promise<void>,
  ): void {
    this.sendMessage = callback;
  }

  async handleInbound(message: InboundMessage): Promise<void> {
    console.log(`[Coordinator] Inbound from ${message.platform}/${message.channelId}: "${message.content.text.slice(0, 80)}"`);

    // Sanitize input
    const sanitized = sanitize(message.content.text);
    if (sanitized.flagged) {
      console.warn(`[Coordinator] Input flagged: ${sanitized.flagReason}`);
      await this.auditLogger.log({
        logId: uuidv4(),
        timestamp: new Date().toISOString(),
        agent: this.agentId,
        actionType: 'input_flagged',
        description: `Prompt injection detected: ${sanitized.flagReason}`,
        correlationId: message.correlationId,
        target: null,
        approvalStatus: 'auto',
        cost: { tokensUsed: 0, tier: ModelTier.FAST, provider: 'none', model: 'none', estimatedUsd: 0 },
      });
    }

    const sanitizedMessage: InboundMessage = {
      ...message,
      content: { ...message.content, text: sanitized.sanitizedText },
    };

    // Classify intent and route
    const decision = await this.clawRouter.classifyIntent(sanitizedMessage);
    console.log(`[Coordinator] Intent: ${decision.intent} (${(decision.confidence * 100).toFixed(0)}%) → ${decision.dispatchMode} → [${decision.targets.join(', ')}]`);

    if (decision.intent === 'clarify') {
      console.log(`[Coordinator] Sending clarifying question`);
      await this.reply(message, decision.clarifyingQuestion ?? 'Could you clarify your request?');
      return;
    }

    // Build task requests
    const baseRequest: TaskRequest = {
      messageId: uuidv4(),
      timestamp: new Date().toISOString(),
      correlationId: message.correlationId,
      type: 'TASK_REQUEST',
      fromAgent: this.agentId,
      toAgent: decision.targets[0]!,
      priority: Priority.P2_STANDARD,
      taskType: decision.intent,
      instructions: sanitized.sanitizedText,
      context: { clientId: this.clientConfig?.clientId ?? 'default' },
      data: {},
      constraints: {
        maxTokens: 4096,
        modelOverride: null,
        timeoutMs: 30_000,
        requiresApproval: false,
        approvalCategory: null,
      },
    };

    let results: TaskResult[] = [];
    const dispatchStart = Date.now();

    try {
      switch (decision.dispatchMode) {
        case 'single':
          results = [await this.dispatcher.dispatchSingle(decision.targets[0]!, baseRequest)];
          break;
        case 'parallel':
          results = await this.dispatcher.dispatchParallel(
            decision.targets,
            decision.targets.map(t => ({ ...baseRequest, toAgent: t })),
          );
          break;
        case 'chain':
          results = [await this.dispatcher.dispatchChain(decision.chainOrder ?? decision.targets, baseRequest)];
          break;
        case 'broadcast':
          results = await this.dispatcher.dispatchBroadcast(
            decision.targets,
            {
              messageId: message.messageId,
              timestamp: message.timestamp,
              correlationId: message.correlationId,
              type: 'HEARTBEAT_TRIGGER',
              triggerName: decision.intent,
              targetAgents: decision.targets,
              parameters: {},
            },
            sanitizedMessage,
          );
          break;
      }
    } catch (err) {
      console.error(`[Coordinator] Dispatch error: ${(err as Error).message}`);
      await this.reply(
        message,
        `I encountered an error: ${(err as Error).message}. Please try again.`,
      );
      return;
    }

    const successCount = results.filter(r => r.status !== 'failed').length;
    console.log(`[Coordinator] Dispatch complete: ${successCount}/${results.length} succeeded in ${Date.now() - dispatchStart}ms`);

    // Handle approvals
    const approvalItems = this.synthesizer.extractPendingApprovals(results);
    if (approvalItems.length > 0) {
      const approvalRequest = await this.approvalManager.createApprovalRequest(approvalItems);
      const text = await this.synthesizer.synthesize(results, sanitizedMessage);
      const outbound: OutboundMessage = {
        platform: message.platform,
        channelId: message.channelId,
        text,
        approvalRequest,
      };
      const payload = formatOutbound(message.platform, outbound);
      await this.sendMessage?.(message.platform, message.channelId, payload);
      return;
    }

    // Synthesize and reply
    const response = await this.synthesizer.synthesize(results, sanitizedMessage);
    await this.reply(message, response);

    // Process side effects
    for (const result of results) {
      for (const sideEffect of result.sideEffects) {
        try {
          const request: TaskRequest = {
            messageId: uuidv4(),
            timestamp: new Date().toISOString(),
            correlationId: message.correlationId,
            type: 'TASK_REQUEST',
            fromAgent: this.agentId,
            toAgent: sideEffect.targetAgent,
            priority: Priority.P3_BACKGROUND,
            taskType: sideEffect.action,
            instructions: '',
            context: { clientId: this.clientConfig?.clientId ?? 'default' },
            data: sideEffect.data,
            constraints: { maxTokens: 2048, modelOverride: null, timeoutMs: 15_000, requiresApproval: false, approvalCategory: null },
          };
          await this.dispatcher.dispatchSingle(sideEffect.targetAgent, request);
        } catch (err) {
          console.error(`[Coordinator] Side effect failed:`, err);
        }
      }
    }
  }

  async handleApprovalResponse(response: ApprovalResponse): Promise<void> {
    await this.approvalManager.processApprovalResponse(response);
  }

  async handleHeartbeat(trigger: HeartbeatTrigger): Promise<void> {
    // Create a synthetic inbound message for the heartbeat
    const syntheticMessage: InboundMessage = {
      messageId: trigger.messageId,
      timestamp: trigger.timestamp,
      correlationId: trigger.correlationId,
      type: 'INBOUND_MESSAGE',
      platform: (this.clientConfig?.primaryPlatform ?? 'discord') as InboundMessage['platform'],
      channelId: this.clientConfig?.platformChannelId ?? '',
      sender: { platformId: 'system', displayName: 'System', isClient: false },
      content: { text: trigger.triggerName, media: [] },
      replyTo: null,
    };

    const results = await this.dispatcher.dispatchBroadcast(
      trigger.targetAgents,
      trigger,
      syntheticMessage,
    );

    // Synthesize briefing if it's a morning or EOD trigger
    if (trigger.triggerName.includes('briefing') || trigger.triggerName.includes('summary')) {
      const text = await this.synthesizer.synthesize(results, syntheticMessage);
      if (text && this.clientConfig) {
        const outbound: OutboundMessage = {
          platform: this.clientConfig.primaryPlatform as InboundMessage['platform'],
          channelId: this.clientConfig.platformChannelId,
          text,
        };
        const payload = formatOutbound(outbound.platform, outbound);
        await this.sendMessage?.(outbound.platform, outbound.channelId, payload);
      }
    }
  }

  registerDispatcher(agent: import('../agents/base-agent.js').BaseAgent): void {
    this.dispatcher.registerAgent(agent);
  }

  private async reply(message: InboundMessage, text: string): Promise<void> {
    const outbound: OutboundMessage = {
      platform: message.platform,
      channelId: message.channelId,
      text,
    };
    const payload = formatOutbound(message.platform, outbound);
    console.log(`[Coordinator] Reply to ${message.platform}/${message.channelId}: "${text.slice(0, 120)}${text.length > 120 ? '…' : ''}"`);
    await this.sendMessage?.(message.platform, message.channelId, payload);
  }
}
