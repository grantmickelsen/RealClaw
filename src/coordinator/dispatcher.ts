import { v4 as uuidv4 } from 'uuid';
import { AgentId, AGENT_CONFIGS } from '../types/agents.js';

interface ChainDispatchConfig {
  chainTaskTypes?: Partial<Record<AgentId, string>>;
}
import type {
  TaskRequest,
  TaskResult,
  InboundMessage,
  HeartbeatTrigger,
} from '../types/messages.js';
import { AgentTimeoutError } from '../utils/errors.js';
import type { BaseAgent } from '../agents/base-agent.js';

export class Dispatcher {
  private readonly agents = new Map<AgentId, BaseAgent>();

  registerAgent(agent: BaseAgent): void {
    this.agents.set(agent.id, agent);
  }

  async dispatchSingle(target: AgentId, request: TaskRequest): Promise<TaskResult> {
    const agent = this.getAgent(target);
    const timeoutMs = AGENT_CONFIGS[target]?.timeoutMs ?? 30_000;
    return this.withTimeout(agent.handleTask(request), timeoutMs, target);
  }

  async dispatchParallel(
    targets: AgentId[],
    requests: TaskRequest[],
  ): Promise<TaskResult[]> {
    const settled = await Promise.allSettled(
      targets.map((target, i) => {
        const request = requests[i] ?? requests[0]!;
        return this.dispatchSingle(target, { ...request, toAgent: target });
      }),
    );

    return settled.map((result, i) => {
      if (result.status === 'fulfilled') return result.value;
      const target = targets[i]!;
      return this.errorResult(requests[i] ?? requests[0]!, target, result.reason as Error);
    });
  }

  async dispatchChain(chain: AgentId[], initialRequest: TaskRequest): Promise<TaskResult> {
    let currentRequest = {
      ...initialRequest,
      context: { ...initialRequest.context, chainTotal: chain.length },
    };
    let lastResult: TaskResult | null = null;

    for (let i = 0; i < chain.length; i++) {
      const target = chain[i]!;
      const chainRule = this.getChainRule(initialRequest.taskType); // NEW
      const taskTypeOverride = chainRule?.chainTaskTypes?.[target] ?? initialRequest.taskType; // NEW

      const request: TaskRequest = {
        ...currentRequest,
        toAgent: target,
        taskType: taskTypeOverride, // NEW OVERRIDE
        context: {
          ...currentRequest.context,
          chainPosition: i,
          upstreamData: lastResult?.result ?? {},
        },
      };

      try {
        lastResult = await this.dispatchSingle(target, request);
        if (lastResult.status === 'failed') break;
        currentRequest = { ...currentRequest, data: { ...currentRequest.data, ...lastResult.result } };
      } catch (err) {
        lastResult = this.errorResult(request, target, err as Error);
        break;
      }
    }

    return lastResult ?? this.errorResult(initialRequest, chain[0]!, new Error('Empty chain'));
  }

  private getChainRule(taskType: string): ChainDispatchConfig | undefined {
    // Load from config - simplified for plan
    const mockConfig = {
      routingRules: {
        chainDispatch: {
          'find_and_send': {
            chainTaskTypes: { relationship: 'follow_up_with', research: 'market_data', content: 'email_campaign_content', comms: 'send_message' }
          }
        }
      }
    };
    return (mockConfig.routingRules.chainDispatch as any)[taskType];
  }


  async dispatchBroadcast(
    targets: AgentId[] | 'all',
    trigger: HeartbeatTrigger,
    originalMessage: InboundMessage,
  ): Promise<TaskResult[]> {
    const resolvedTargets =
      targets === 'all' ? [...this.agents.keys()] : targets;

    const requests: TaskRequest[] = resolvedTargets.map(target => ({
      messageId: uuidv4(),
      timestamp: new Date().toISOString(),
      correlationId: trigger.correlationId,
      type: 'TASK_REQUEST' as const,
      fromAgent: AgentId.COORDINATOR,
      toAgent: target,
      priority: 3,
      taskType: 'heartbeat',
      instructions: `Heartbeat: ${trigger.triggerName}`,
      context: { clientId: '' },
      data: trigger.parameters,
      constraints: {
        maxTokens: 4096,
        modelOverride: null,
        timeoutMs: AGENT_CONFIGS[target]?.timeoutMs ?? 30_000,
        requiresApproval: false,
        approvalCategory: null,
      },
    }));

    return this.dispatchParallel(resolvedTargets, requests);
  }

  private getAgent(id: AgentId): BaseAgent {
    const agent = this.agents.get(id);
    if (!agent) {
      throw new Error(`Agent not registered: ${id}`);
    }
    return agent;
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    agentId: AgentId,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new AgentTimeoutError(agentId, timeoutMs));
      }, timeoutMs);

      promise
        .then(value => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch(err => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  private errorResult(request: TaskRequest, agentId: AgentId, error: Error): TaskResult {
    return {
      messageId: uuidv4(),
      timestamp: new Date().toISOString(),
      correlationId: request.correlationId,
      type: 'TASK_RESULT',
      fromAgent: agentId,
      toAgent: AgentId.COORDINATOR,
      status: 'failed',
      resultType: 'text',
      result: { error: error.message },
      sideEffects: [],
      knowledgeUpdates: [],
      metadata: {
        tier: 'fast' as never,
        provider: 'none',
        modelUsed: 'none',
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
        processingMs: 0,
        retryCount: 0,
      },
    };
  }
}
