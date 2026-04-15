import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import type { AgentConfig } from '../types/agents.js';
import log from '../utils/logger.js';
import { AgentId, ModelTier } from '../types/agents.js';
import type {
  TaskRequest,
  TaskResult,
  AgentQuery,
  QueryResponse,
  BriefingSection,
} from '../types/messages.js';
import type { MemoryReadRequest, MemoryReadResult, MemoryWriteRequest, MemoryWriteResult } from '../types/memory.js';
import type { EventType } from '../types/events.js';
import type { LlmRouter } from '../llm/router.js';
import type { LlmRequest, LlmResponse } from '../llm/types.js';
import { MemoryManager } from '../memory/memory-manager.js';
import type { IEventBus } from './ops/event-bus.js';
import type { AuditLogger } from '../middleware/audit-logger.js';
import type { AuditEntry } from '../types/messages.js';
import type { IntegrationManager } from '../integrations/integration-manager.js';
import type { BaseIntegration } from '../integrations/base-integration.js';
import type { IntegrationId } from '../types/integrations.js';

export abstract class BaseAgent {
  readonly id: AgentId;
  readonly config: AgentConfig;
  protected readonly tenantId: string;
  protected readonly memory: MemoryManager;
  protected readonly llmRouter: LlmRouter;
  protected readonly eventBus: IEventBus;
  protected readonly auditLogger: AuditLogger;
  private soulPrompt = '';

  // Agent registry for cross-agent queries
  private agentRegistry?: Map<AgentId, BaseAgent>;
  private integrationManager?: IntegrationManager;

  constructor(
    config: AgentConfig,
    llmRouter: LlmRouter,
    memory: MemoryManager,
    eventBus: IEventBus,
    auditLogger: AuditLogger,
    tenantId: string = 'default',
  ) {
    this.id = config.id;
    this.config = config;
    this.llmRouter = llmRouter;
    this.memory = memory;
    this.eventBus = eventBus;
    this.auditLogger = auditLogger;
    this.tenantId = tenantId;
  }

  setAgentRegistry(registry: Map<AgentId, BaseAgent>): void {
    this.agentRegistry = registry;
  }

  setIntegrationManager(manager: IntegrationManager): void {
    this.integrationManager = manager;
  }

  protected getIntegration<T extends BaseIntegration>(id: IntegrationId): T | null {
    return this.integrationManager?.getIntegration<T>(id) ?? null;
  }

  /** Called once after construction. Loads SOUL.md. */
  async init(): Promise<void> {
    try {
      this.soulPrompt = await fs.readFile(this.config.soulMdPath, 'utf-8');
    } catch {
      this.soulPrompt = `You are the ${this.config.displayName} for a real estate executive assistant.`;
    }

    // Subscribe to events
    for (const eventType of this.config.subscribesTo) {
      this.eventBus.subscribe(eventType, event => {
        this.onEvent(event.eventType, event.payload).catch(err => {
          log.error(`[${this.id}] Event handler error`, { error: (err as Error).message });
        });
      });
    }
  }

  abstract handleTask(request: TaskRequest): Promise<TaskResult>;
  abstract handleQuery(query: AgentQuery): Promise<QueryResponse>;
  abstract contributeToBriefing(scope: string): Promise<BriefingSection>;

  /** Override to handle subscribed events */
  protected async onEvent(
    _eventType: EventType,
    _payload: Record<string, unknown>,
  ): Promise<void> {}

  // ─── Shared utilities ───

  protected async callLlm(
    prompt: string,
    tier?: ModelTier,
    options?: Partial<LlmRequest>,
  ): Promise<LlmResponse> {
    const request: LlmRequest = {
      model: tier ?? this.config.defaultModel,
      systemPrompt: this.soulPrompt,
      messages: [{ role: 'user', content: prompt }],
      ...options,
    };
    return this.llmRouter.complete(request, this.id);
  }

  protected async ask(prompt: string, tier?: ModelTier): Promise<string> {
    const response = await this.callLlm(prompt, tier);
    return response.text;
  }

  protected async queryAgent(
    target: AgentId,
    query: AgentQuery,
  ): Promise<QueryResponse> {
    if (!this.config.queryTargets.includes(target)) {
      throw new Error(`Agent ${this.id} is not authorized to query ${target}`);
    }

    const agent = this.agentRegistry?.get(target);
    if (!agent) {
      return {
        messageId: uuidv4(),
        timestamp: new Date().toISOString(),
        correlationId: query.correlationId,
        type: 'QUERY_RESPONSE',
        fromAgent: target,
        toAgent: this.id,
        queryId: query.messageId,
        found: false,
        data: { error: `Agent ${target} not available` },
      };
    }

    return agent.handleQuery(query);
  }

  protected async readMemory(request: MemoryReadRequest): Promise<MemoryReadResult> {
    return this.memory.read(request);
  }

  protected async writeMemory(request: MemoryWriteRequest): Promise<MemoryWriteResult> {
    // Validate domain access
    const domain = request.path.split('/')[0] as import('../types/memory.js').MemoryDomain;
    if (!this.config.writeTargets.includes(domain)) {
      return {
        path: request.path,
        success: false,
        operation: request.operation,
        newSize: 0,
        error: `Agent ${this.id} is not authorized to write to domain: ${domain}`,
      };
    }
    return this.memory.write({ ...request, writtenBy: this.id });
  }

  protected emitEvent(eventType: EventType, payload: Record<string, unknown>): void {
    this.eventBus.emit({
      messageId: uuidv4(),
      timestamp: new Date().toISOString(),
      correlationId: uuidv4(),
      type: 'EVENT',
      eventType,
      emittedBy: this.id,
      payload,
    });
  }

  protected async log(entry: Partial<AuditEntry>): Promise<void> {
    await this.auditLogger.log({
      logId: uuidv4(),
      timestamp: new Date().toISOString(),
      agent: this.id,
      actionType: 'unknown',
      description: '',
      correlationId: '',
      target: null,
      approvalStatus: 'auto',
      cost: {
        tokensUsed: 0,
        tier: ModelTier.FAST,
        provider: 'none',
        model: 'none',
        estimatedUsd: 0,
      },
      ...entry,
    });
  }

  /** Build a standard successful TaskResult */
  protected successResult(
    request: TaskRequest,
    result: Record<string, unknown>,
    options: {
      resultType?: TaskResult['resultType'];
      approval?: TaskResult['approval'];
      sideEffects?: TaskResult['sideEffects'];
      knowledgeUpdates?: TaskResult['knowledgeUpdates'];
      processingMs?: number;
      llmResponse?: LlmResponse;
    } = {},
  ): TaskResult {
    return {
      messageId: uuidv4(),
      timestamp: new Date().toISOString(),
      correlationId: request.correlationId,
      type: 'TASK_RESULT',
      fromAgent: this.id,
      toAgent: AgentId.COORDINATOR,
      status: options.approval ? 'needs_approval' : 'success',
      resultType: options.resultType ?? 'text',
      result,
      approval: options.approval,
      sideEffects: options.sideEffects ?? [],
      knowledgeUpdates: options.knowledgeUpdates ?? [],
      metadata: {
        tier: options.llmResponse
          ? (request.constraints.modelOverride ?? this.config.defaultModel)
          : this.config.defaultModel,
        provider: options.llmResponse?.provider ?? 'none',
        modelUsed: options.llmResponse?.model ?? 'none',
        inputTokens: options.llmResponse?.inputTokens ?? 0,
        outputTokens: options.llmResponse?.outputTokens ?? 0,
        estimatedCostUsd: options.llmResponse?.estimatedCostUsd ?? 0,
        processingMs: options.processingMs ?? 0,
        retryCount: 0,
      },
    };
  }

  /** Build a standard failure TaskResult */
  protected failureResult(request: TaskRequest, error: Error): TaskResult {
    return {
      messageId: uuidv4(),
      timestamp: new Date().toISOString(),
      correlationId: request.correlationId,
      type: 'TASK_RESULT',
      fromAgent: this.id,
      toAgent: AgentId.COORDINATOR,
      status: 'failed',
      resultType: 'text',
      result: { error: error.message },
      sideEffects: [],
      knowledgeUpdates: [],
      metadata: {
        tier: this.config.defaultModel,
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

  /** Build a standard QueryResponse */
  protected queryResponse(
    query: AgentQuery,
    found: boolean,
    data: Record<string, unknown>,
  ): QueryResponse {
    return {
      messageId: uuidv4(),
      timestamp: new Date().toISOString(),
      correlationId: query.correlationId,
      type: 'QUERY_RESPONSE',
      fromAgent: this.id,
      toAgent: query.fromAgent,
      queryId: query.messageId,
      found,
      data,
    };
  }
}
