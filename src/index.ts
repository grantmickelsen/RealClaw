/**
 * Claw — Gateway Bootstrap
 *
 * Entry point for the RealEstate OpenClaw Executive Assistant.
 * Initializes all services, agents, and the HTTP gateway.
 */

import 'dotenv/config';
import http from 'http';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { WebSocketServer, WebSocket } from 'ws';

import Redis from 'ioredis';
import { createLlmRouter } from './llm/factory.js';
import { MemoryManager } from './memory/memory-manager.js';
import { CredentialVault } from './credentials/vault.js';
import { createRateLimiter } from './middleware/rate-limiter.js';
import { AuditLogger } from './middleware/audit-logger.js';
import { HeartbeatScheduler } from './agents/ops/heartbeat.js';
import { BullMqHeartbeatScheduler, parseRedisUrl } from './agents/ops/bullmq-heartbeat.js';
import { createEventBus } from './agents/ops/redis-event-bus.js';
import { createDistributedLock } from './memory/distributed-lock.js';
import { createPushNotificationService } from './gateway/push-notification.js';
import type { PushNotificationService } from './gateway/push-notification.js';
import { upsertTenant } from './db/tenant-ops.js';
import { query, closePool } from './db/postgres.js';
import { Coordinator } from './coordinator/coordinator.js';
import { IntegrationManager } from './integrations/integration-manager.js';
import { bootstrapCredentialsFromEnv } from './setup/credential-bootstrap.js';
import { OAuthHandler } from './credentials/oauth-handler.js';
import { extractTenant } from './middleware/auth.js';
import type { AuthContext } from './middleware/auth.js';
import { AuthError } from './middleware/auth.js';
import { WsSessionManager } from './gateway/ws-session-manager.js';
import { createCancellationStore } from './gateway/cancellation-store.js';
import { TaskCancelledError } from './utils/errors.js';

// ─── Agents ───
import { KnowledgeBaseAgent } from './agents/knowledge-base/knowledge-base.js';
import { ComplianceAgent } from './agents/compliance/compliance.js';
import { RelationshipAgent } from './agents/relationship/relationship.js';
import { CommsAgent } from './agents/comms/comms.js';
import { CalendarAgent } from './agents/calendar/calendar.js';
import { ContentAgent } from './agents/content/content.js';
import { ResearchAgent } from './agents/research/research.js';
import { TransactionAgent } from './agents/transaction/transaction.js';
import { OpsAgent } from './agents/ops/ops.js';
import { OpenHouseAgent } from './agents/open-house/open-house.js';

import { AGENT_CONFIGS, AgentId } from './types/agents.js';
import type { BaseAgent } from './agents/base-agent.js';
import type { InboundMessage, ApprovalResponse } from './types/messages.js';
import { normalizeInbound } from './utils/normalize.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = path.resolve(__dirname, '..', 'config');
const MODELS_CONFIG = path.join(CONFIG_DIR, 'models.json');
const HEARTBEAT_CONFIG = path.join(CONFIG_DIR, 'heartbeat.json');
const INTEGRATIONS_CONFIG = path.join(CONFIG_DIR, 'integrations.json');
const PORT = parseInt(process.env.OPENCLAW_GATEWAY_PORT ?? '18789', 10);
const OAUTH_REDIRECT_BASE = process.env.CLAW_OAUTH_REDIRECT_BASE ?? `http://localhost:${PORT}`;

// CSRF state store — maps state token → { integrationId, expiresAt }
const oauthStateStore = new Map<string, { integrationId: string; expiresAt: number }>();

// ─── Logging ───

function log(level: 'info' | 'warn' | 'error', message: string, ...args: unknown[]): void {
  const ts = new Date().toISOString();
  const logLevel = (process.env.OPENCLAW_LOG_LEVEL ?? 'info').toLowerCase();
  const levels = { info: 0, warn: 1, error: 2 };
  if ((levels[level] ?? 0) >= (levels[logLevel as keyof typeof levels] ?? 0)) {
    console[level](`[${ts}] [${level.toUpperCase()}] ${message}`, ...args);
  }
}

// ─── TenantRegistry ──────────────────────────────────────────────────────────

interface TenantEntry {
  coordinator: Coordinator;
  heartbeat: HeartbeatScheduler | BullMqHeartbeatScheduler;
  integrationManager: IntegrationManager;
}

class TenantRegistry {
  private readonly entries = new Map<string, TenantEntry>();

  constructor(
    private readonly memoryPath: string,
    private readonly llmRouter: Awaited<ReturnType<typeof createLlmRouter>>,
    private readonly vault: CredentialVault,
    private readonly integrationConfigPath: string,
    private readonly responseStore: Map<string, { platform: string; payload: unknown; timestamp: string }[]>,
    private readonly wsSessionManager?: WsSessionManager,
    private readonly redisClient?: Redis,
    private readonly pushService?: PushNotificationService | null,
    private readonly bullMqConnection?: ReturnType<typeof parseRedisUrl>,
    private readonly dbAvailable?: boolean,
  ) {}

  async getOrCreate(tenantId: string): Promise<Coordinator> {
    const existing = this.entries.get(tenantId);
    if (existing) return existing.coordinator;

    log('info', `[TenantRegistry] Initializing tenant: ${tenantId}`);

    // Ensure tenant row exists in DB before any FK-constrained writes
    if (this.dbAvailable) {
      await upsertTenant(tenantId);
    }

    const tenantMemoryPath = path.join(this.memoryPath, 'tenants', tenantId);
    const distributedLock = createDistributedLock(this.redisClient);
    const tenantMemory = new MemoryManager(this.memoryPath, tenantId, distributedLock);
    const tenantEventBus = createEventBus(this.redisClient, tenantId);
    const tenantAuditLogger = new AuditLogger(path.join(tenantMemoryPath, 'system'), undefined, tenantId);

    // Per-tenant rate limiter and integration manager — full quota isolation
    const tenantRateLimiter = createRateLimiter(this.redisClient);
    const tenantIntegrationManager = await IntegrationManager.fromConfigFile(
      this.integrationConfigPath, this.vault, tenantRateLimiter, tenantAuditLogger, tenantId,
    );

    // ─── Agent registry ───
    const agentRegistry = new Map<AgentId, BaseAgent>();

    const makeAgent = <T extends BaseAgent>(
      Cls: new (...args: ConstructorParameters<typeof import('./agents/base-agent.js').BaseAgent>) => T,
      id: AgentId,
    ): T => {
      const config = AGENT_CONFIGS[id];
      return new Cls(config, this.llmRouter, tenantMemory, tenantEventBus, tenantAuditLogger, tenantId);
    };

    agentRegistry.set(AgentId.KNOWLEDGE_BASE, makeAgent(KnowledgeBaseAgent, AgentId.KNOWLEDGE_BASE));
    agentRegistry.set(AgentId.COMPLIANCE,     makeAgent(ComplianceAgent,     AgentId.COMPLIANCE));
    agentRegistry.set(AgentId.RELATIONSHIP,   makeAgent(RelationshipAgent,   AgentId.RELATIONSHIP));
    agentRegistry.set(AgentId.COMMS,          makeAgent(CommsAgent,          AgentId.COMMS));
    agentRegistry.set(AgentId.CALENDAR,       makeAgent(CalendarAgent,       AgentId.CALENDAR));
    agentRegistry.set(AgentId.CONTENT,        makeAgent(ContentAgent,        AgentId.CONTENT));
    agentRegistry.set(AgentId.RESEARCH,       makeAgent(ResearchAgent,       AgentId.RESEARCH));
    agentRegistry.set(AgentId.TRANSACTION,    makeAgent(TransactionAgent,    AgentId.TRANSACTION));
    agentRegistry.set(AgentId.OPS,            makeAgent(OpsAgent,            AgentId.OPS));
    agentRegistry.set(AgentId.OPEN_HOUSE,     makeAgent(OpenHouseAgent,      AgentId.OPEN_HOUSE));

    for (const agent of agentRegistry.values()) {
      agent.setAgentRegistry(agentRegistry);
      agent.setIntegrationManager(tenantIntegrationManager);
    }

    await Promise.all([...agentRegistry.values()].map(a => a.init()));
    log('info', `[TenantRegistry:${tenantId}] ${agentRegistry.size} agents ready`);

    // ─── Coordinator ───
    const queryFn = this.dbAvailable ? query : undefined;
    const coordinator = new Coordinator(tenantId, tenantMemoryPath, this.llmRouter, tenantAuditLogger, tenantEventBus, queryFn);
    await coordinator.init(CONFIG_DIR);

    for (const agent of agentRegistry.values()) {
      coordinator.registerDispatcher(agent);
    }

    coordinator.onSendMessage(async (platform, channelId, payload, correlationId) => {
      log('info', `[Outbound:${tenantId}] ${platform}/${channelId}: ${JSON.stringify(payload).slice(0, 200)}`);
      const key = `${tenantId}:${channelId}`;
      const history = this.responseStore.get(key) ?? [];
      history.push({ platform, payload, timestamp: new Date().toISOString() });
      if (history.length > 50) history.shift();
      this.responseStore.set(key, history);

      // Push TASK_COMPLETE via WebSocket if correlationId is available
      if (correlationId && this.wsSessionManager) {
        this.wsSessionManager.push(tenantId, {
          type: 'TASK_COMPLETE',
          correlationId,
          tenantId,
          timestamp: new Date().toISOString(),
          payload: {
            text: (payload as { text?: string }).text ?? '',
            agentId: 'coordinator',
            processingMs: 0,
            hasApproval: !!(payload as { approvalRequest?: unknown }).approvalRequest,
          },
        });
      }
    });

    // Wire WsPusher so coordinator can push AGENT_TYPING + TOKEN_STREAM events
    if (this.wsSessionManager) {
      coordinator.onWsPush(this.wsSessionManager);
    }

    // Wire SYNC_UPDATE events when memory is written
    if (this.wsSessionManager) {
      tenantMemory.onMemoryWrite((domain, relativePath, operation) => {
        this.wsSessionManager!.push(tenantId, {
          type: 'SYNC_UPDATE',
          correlationId: '',
          tenantId,
          timestamp: new Date().toISOString(),
          payload: { domain, path: relativePath, operation },
        });
      });
    }

    // ─── Push notification EventBus wiring ───
    if (this.pushService) {
      tenantEventBus.subscribe('system.integration_down', event => {
        void this.pushService!.sendIntegrationDownPush(tenantId, event.payload['integrationId'] as string);
      });
      tenantEventBus.subscribe('lead.decay_detected', event => {
        void this.pushService!.sendLeadDecayPush(
          tenantId,
          event.payload['contactName'] as string,
          event.payload['daysSince'] as number,
        );
      });
    }

    // ─── Heartbeat ───
    let heartbeat: HeartbeatScheduler | BullMqHeartbeatScheduler;

    // Load heartbeat config (try tenant-specific first, then shared)
    let heartbeatConfig: unknown = null;
    const tenantHeartbeatConfig = path.join(CONFIG_DIR, 'tenants', tenantId, 'heartbeat.json');
    for (const configPath of [tenantHeartbeatConfig, HEARTBEAT_CONFIG]) {
      try {
        const raw = await fs.readFile(configPath, 'utf-8');
        heartbeatConfig = JSON.parse(raw);
        break;
      } catch {
        // try next
      }
    }

    if (this.bullMqConnection && heartbeatConfig) {
      // Distributed BullMQ heartbeat — survives process restarts, per-tenant jitter
      const bullMqHb = new BullMqHeartbeatScheduler(this.bullMqConnection);
      bullMqHb.onTrigger(trigger => coordinator.handleHeartbeat(trigger));
      await bullMqHb.loadForTenant(tenantId, heartbeatConfig as Parameters<BullMqHeartbeatScheduler['loadForTenant']>[1]);
      log('info', `[TenantRegistry:${tenantId}] Heartbeat: BullMQ loaded (${bullMqHb.listScheduled(tenantId).length} queue(s))`);
      heartbeat = bullMqHb;
    } else {
      // In-process node-cron heartbeat — for dev/single-instance deployments
      const cronHb = new HeartbeatScheduler();
      cronHb.onTrigger(trigger => coordinator.handleHeartbeat(trigger));
      if (heartbeatConfig) {
        cronHb.load(heartbeatConfig as Parameters<HeartbeatScheduler['load']>[0], tenantId);
        log('info', `[TenantRegistry:${tenantId}] Heartbeat: cron loaded (${cronHb.listScheduled().length} schedule(s))`);
      } else {
        log('warn', `[TenantRegistry:${tenantId}] No heartbeat config found — scheduled tasks disabled`);
      }
      heartbeat = cronHb;
    }

    this.entries.set(tenantId, { coordinator, heartbeat, integrationManager: tenantIntegrationManager });
    return coordinator;
  }

  getIntegrationManager(tenantId: string): IntegrationManager | undefined {
    return this.entries.get(tenantId)?.integrationManager;
  }

  async stopAll(): Promise<void> {
    const stops: Promise<void>[] = [];
    for (const { heartbeat } of this.entries.values()) {
      if (heartbeat instanceof BullMqHeartbeatScheduler) {
        stops.push(heartbeat.stopAll());
      } else {
        heartbeat.stop();
      }
    }
    await Promise.all(stops);
  }

  size(): number {
    return this.entries.size;
  }
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function bootstrap(): Promise<void> {
  log('info', 'Starting Claw gateway...');

  // ─── Core Services ───
  const memoryPath = process.env.CLAW_MEMORY_PATH ?? path.resolve(__dirname, '..', 'memory');
  const vault = new CredentialVault();

  const bootstrapResult = await bootstrapCredentialsFromEnv(vault);
  log('info', `Credential bootstrap: seeded=[${bootstrapResult.seeded.join(',')}]`);
  for (const f of bootstrapResult.failed) {
    log('warn', `Bootstrap failed ${f.id}: ${f.error}`);
  }

  // ─── WebSocket Session Manager + Cancellation Store ───
  const wsSessionManager = new WsSessionManager();
  const cancellationStore = createCancellationStore(process.env.REDIS_URL);

  // ─── Redis client (optional — enables distributed locking, event bus, BullMQ, rate limiting) ───
  let redisClient: Redis | undefined;
  if (process.env.REDIS_URL) {
    redisClient = new Redis(process.env.REDIS_URL, { lazyConnect: true, enableOfflineQueue: false });
    redisClient.on('error', (err: Error) => log('error', '[Redis] Connection error:', err.message));
    redisClient.on('connect', () => log('info', '[Redis] Connected'));
    log('info', `[Redis] Configured — host: ${new URL(process.env.REDIS_URL).hostname}`);
  } else {
    log('info', '[Redis] Not configured — using in-process fallbacks for locking, events, rate-limiting');
  }

  // ─── DB availability + push notification service ───
  const dbAvailable = !!process.env.DATABASE_URL;
  const pushService = dbAvailable ? createPushNotificationService(query) : null;
  if (pushService) {
    log('info', '[Push] Push notification service enabled');
  }

  // ─── BullMQ connection (used for distributed heartbeat scheduler) ───
  const bullMqConnection = process.env.REDIS_URL ? parseRedisUrl(process.env.REDIS_URL) : undefined;
  if (bullMqConnection) {
    log('info', '[BullMQ] Distributed heartbeat scheduling enabled');
  }

  log('info', 'Initializing LLM router...');
  const llmRouter = await createLlmRouter(MODELS_CONFIG, cancellationStore);

  log('info', 'Running LLM health checks...');
  const health = await llmRouter.healthCheckAll();
  for (const [provider, ok] of Object.entries(health)) {
    log(ok ? 'info' : 'warn', `  Provider ${provider}: ${ok ? 'OK' : 'UNAVAILABLE'}`);
  }

  // ─── Response store (keyed by tenantId:channelId) ───
  const responseStore = new Map<string, { platform: string; payload: unknown; timestamp: string }[]>();

  // ─── Tenant registry ───
  const tenantRegistry = new TenantRegistry(
    memoryPath, llmRouter, vault, INTEGRATIONS_CONFIG, responseStore,
    wsSessionManager, redisClient, pushService, bullMqConnection, dbAvailable,
  );

  // Eagerly initialize the default tenant for backward compatibility
  await tenantRegistry.getOrCreate('default');
  log('info', `Gateway ready — ${tenantRegistry.size()} tenant(s) initialized`);

  // ─── Gateway HTTP Server ───
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Tenant-Id');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // ─── Health check ───
    if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/v1/health')) {
      const auth = extractTenant(req);
      const llmHealth = await llmRouter.healthCheckAll();
      sendJson(res, 200, {
        status: 'ok',
        tenantId: auth?.tenantId ?? 'unauthenticated',
        tenants: tenantRegistry.size(),
        llm: llmHealth,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // ─── GET /v1/tenants/me ───
    if (req.method === 'GET' && url.pathname === '/v1/tenants/me') {
      let auth: AuthContext;
      try {
        auth = requireAuth(req);
      } catch (err) {
        sendJson(res, 401, { ok: false, error: (err as Error).message });
        return;
      }
      sendJson(res, 200, { tenantId: auth.tenantId, userId: auth.userId });
      return;
    }

    // ─── POST /v1/messages (JWT required) — async 202 ───
    if (req.method === 'POST' && url.pathname === '/v1/messages') {
      let auth: AuthContext;
      try {
        auth = requireAuth(req);
      } catch (err) {
        sendJson(res, 401, { ok: false, error: (err as Error).message });
        return;
      }
      let body: string;
      try {
        body = await readBody(req);
      } catch (err) {
        sendJson(res, 400, { ok: false, error: 'Failed to read request body' });
        return;
      }
      let message: InboundMessage;
      try {
        const raw = JSON.parse(body) as Record<string, unknown>;
        const platform = String(raw['platform'] ?? 'mobile');
        message = normalizeInbound(platform, raw);
      } catch (err) {
        sendJson(res, 400, { ok: false, error: (err as Error).message });
        return;
      }

      // Respond immediately — result delivered via WebSocket
      sendJson(res, 202, { ok: true, messageId: message.messageId, correlationId: message.correlationId });

      // Create AbortController for this request
      const controller = new AbortController();
      const { tenantId } = auth;
      const { correlationId } = message;

      // Register controller so WS close can abort it
      const sockets = wsSessionManager.getSockets(tenantId);
      for (const ws of sockets) {
        wsSessionManager.trackRequest(ws, correlationId, controller);
      }

      setImmediate(async () => {
        try {
          const coordinator = await tenantRegistry.getOrCreate(tenantId);
          await coordinator.handleInbound(message, controller.signal);
        } catch (err) {
          if (err instanceof TaskCancelledError) return;
          log('error', `[Gateway] Async message error for ${tenantId}/${correlationId}:`, err);
          wsSessionManager.push(tenantId, {
            type: 'ERROR',
            correlationId,
            tenantId,
            timestamp: new Date().toISOString(),
            payload: { message: (err as Error).message },
          });
        } finally {
          // Untrack the AbortController
          const activeSockets = wsSessionManager.getSockets(tenantId);
          for (const ws of activeSockets) {
            wsSessionManager.untrackRequest(ws, correlationId);
          }
        }
      });
      return;
    }

    // ─── POST /v1/approvals/:approvalId (JWT required) ───
    if (req.method === 'POST' && url.pathname.startsWith('/v1/approvals/')) {
      let auth: AuthContext;
      try {
        auth = requireAuth(req);
      } catch (err) {
        sendJson(res, 401, { ok: false, error: (err as Error).message });
        return;
      }
      try {
        const body = await readBody(req);
        const response = JSON.parse(body) as ApprovalResponse;
        const coordinator = await tenantRegistry.getOrCreate(auth.tenantId);
        await coordinator.handleApprovalResponse(response);
        sendJson(res, 200, { ok: true });
      } catch (err) {
        sendJson(res, 400, { ok: false, error: (err as Error).message });
      }
      return;
    }

    // ─── GET /v1/messages/:channelId (JWT required) ───
    if (req.method === 'GET' && url.pathname.startsWith('/v1/messages/')) {
      let auth: AuthContext;
      try {
        auth = requireAuth(req);
      } catch (err) {
        sendJson(res, 401, { ok: false, error: (err as Error).message });
        return;
      }
      const channelId = decodeURIComponent(url.pathname.slice('/v1/messages/'.length));
      const key = `${auth.tenantId}:${channelId}`;
      const responses = responseStore.get(key) ?? [];
      sendJson(res, 200, { channelId, count: responses.length, responses });
      return;
    }

    // ─── GET /v1/integrations (JWT required) ───
    if (req.method === 'GET' && url.pathname === '/v1/integrations') {
      let auth: AuthContext;
      try {
        auth = requireAuth(req);
      } catch (err) {
        sendJson(res, 401, { ok: false, error: (err as Error).message });
        return;
      }
      const mgr = tenantRegistry.getIntegrationManager(auth.tenantId);
      if (!mgr) {
        sendJson(res, 200, { integrations: [] });
        return;
      }
      const statuses = await mgr.getStatus();
      sendJson(res, 200, { integrations: statuses });
      return;
    }

    // ─── POST /v1/devices (JWT required) — register Expo push token ───
    if (req.method === 'POST' && url.pathname === '/v1/devices') {
      let auth: AuthContext;
      try {
        auth = requireAuth(req);
      } catch (err) {
        sendJson(res, 401, { ok: false, error: (err as Error).message });
        return;
      }
      if (!pushService) {
        sendJson(res, 503, { ok: false, error: 'Push notifications not configured (DATABASE_URL required)' });
        return;
      }
      let body: string;
      try {
        body = await readBody(req);
      } catch {
        sendJson(res, 400, { ok: false, error: 'Failed to read request body' });
        return;
      }
      try {
        const { userId, token, platform } = JSON.parse(body) as {
          userId?: string;
          token?: string;
          platform?: 'ios' | 'android';
        };
        if (!userId || !token) {
          sendJson(res, 400, { ok: false, error: 'userId and token are required' });
          return;
        }
        await pushService.registerDevice(auth.tenantId, userId, token, platform ?? 'ios');
        sendJson(res, 200, { ok: true });
      } catch (err) {
        sendJson(res, 400, { ok: false, error: (err as Error).message });
      }
      return;
    }

    // ─── Legacy: POST /message (no auth — uses default tenant) ───
    if (req.method === 'POST' && url.pathname === '/message') {
      try {
        const body = await readBody(req);
        const raw = JSON.parse(body) as Record<string, unknown>;
        const platform = String(raw['platform'] ?? 'discord');
        const message = normalizeInbound(platform, raw);
        const coordinator = await tenantRegistry.getOrCreate('default');
        await coordinator.handleInbound(message);
        sendJson(res, 200, { ok: true, messageId: message.messageId });
      } catch (err) {
        sendJson(res, 400, { ok: false, error: (err as Error).message });
      }
      return;
    }

    // ─── Legacy: POST /approval (no auth — uses default tenant) ───
    if (req.method === 'POST' && url.pathname === '/approval') {
      try {
        const body = await readBody(req);
        const response = JSON.parse(body) as ApprovalResponse;
        const coordinator = await tenantRegistry.getOrCreate('default');
        await coordinator.handleApprovalResponse(response);
        sendJson(res, 200, { ok: true });
      } catch (err) {
        sendJson(res, 400, { ok: false, error: (err as Error).message });
      }
      return;
    }

    // ─── OAuth: initiate flow ─────────────────────────────────────────────────
    if (req.method === 'GET' && url.pathname.startsWith('/oauth/connect/')) {
      const integrationId = url.pathname.slice('/oauth/connect/'.length);
      const clientId = await vault.retrieve(integrationId as never, 'client_id')
        ?? process.env[`CLAW_${integrationId.toUpperCase()}_CLIENT_ID`]
        ?? null;
      const clientSecret = await vault.retrieve(integrationId as never, 'client_secret')
        ?? process.env[`CLAW_${integrationId.toUpperCase()}_CLIENT_SECRET`]
        ?? null;

      if (!clientId || !clientSecret) {
        sendJson(res, 400, { error: `OAuth credentials for ${integrationId} not configured` });
        return;
      }

      // Purge expired state entries
      const now = Date.now();
      for (const [k, v] of oauthStateStore.entries()) {
        if (v.expiresAt < now) oauthStateStore.delete(k);
      }

      const state = uuidv4();
      oauthStateStore.set(state, { integrationId, expiresAt: now + 10 * 60 * 1000 });

      const oauthConfig = {
        clientId,
        clientSecret,
        authUrl: getAuthUrl(integrationId),
        tokenUrl: getTokenUrl(integrationId),
        redirectUri: `${OAUTH_REDIRECT_BASE}/oauth/${integrationId}/callback`,
        scopes: getScopes(integrationId),
      };

      const handler = new OAuthHandler(vault);
      const authUrl = handler.buildAuthUrl(oauthConfig, state);
      res.writeHead(302, { Location: authUrl });
      res.end();
      return;
    }

    // ─── OAuth: callback ──────────────────────────────────────────────────────
    if (req.method === 'GET' && url.pathname.match(/^\/oauth\/[^/]+\/callback$/)) {
      const parts = url.pathname.split('/');
      const integrationId = parts[2];
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');

      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`<html><body><h1>OAuth Error</h1><p>${error}</p></body></html>`);
        return;
      }

      const stateEntry = state ? oauthStateStore.get(state) : null;
      if (!code || !stateEntry || stateEntry.integrationId !== integrationId || stateEntry.expiresAt < Date.now()) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>Invalid OAuth callback</h1><p>State mismatch or expired.</p></body></html>');
        return;
      }

      oauthStateStore.delete(state!);

      try {
        const clientId = await vault.retrieve(integrationId as never, 'client_id')
          ?? process.env[`CLAW_${integrationId.toUpperCase()}_CLIENT_ID`]!;
        const clientSecret = await vault.retrieve(integrationId as never, 'client_secret')
          ?? process.env[`CLAW_${integrationId.toUpperCase()}_CLIENT_SECRET`]!;

        const oauthConfig = {
          clientId,
          clientSecret,
          authUrl: getAuthUrl(integrationId),
          tokenUrl: getTokenUrl(integrationId),
          redirectUri: `${OAUTH_REDIRECT_BASE}/oauth/${integrationId}/callback`,
          scopes: getScopes(integrationId),
        };

        const handler = new OAuthHandler(vault);
        const tokens = await handler.exchangeCode(oauthConfig, code);
        await handler.storeTokens(integrationId as never, tokens);
        await setIntegrationEnabled(INTEGRATIONS_CONFIG, integrationId);

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<html><body><h1>Connected!</h1><p>${integrationId} is now connected. You may close this window.</p></body></html>`);
      } catch (err) {
        log('error', `OAuth callback failed for ${integrationId}:`, err);
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>OAuth Failed</h1><p>Check gateway logs for details.</p></body></html>');
      }
      return;
    }

    // ─── Legacy: GET /response/:channelId (default tenant) ───────────────────
    if (req.method === 'GET' && url.pathname.startsWith('/response/')) {
      const channelId = decodeURIComponent(url.pathname.slice('/response/'.length));
      const key = `default:${channelId}`;
      const responses = responseStore.get(key) ?? [];
      sendJson(res, 200, { channelId, count: responses.length, responses });
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  });

  // ─── WebSocket Server ───
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const upgradeUrl = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    if (upgradeUrl.pathname !== '/ws') {
      socket.destroy();
      return;
    }

    const token = upgradeUrl.searchParams.get('token');
    let auth: AuthContext;
    try {
      auth = requireAuth({ headers: { authorization: token ? `Bearer ${token}` : '' } } as http.IncomingMessage);
    } catch {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wsSessionManager.register(auth.tenantId, ws);

      // Ping every 25 s — client must pong or server closes
      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.ping();
      }, 25_000);

      ws.on('pong', () => { /* keep-alive acknowledged */ });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString()) as { type?: string; correlationIds?: unknown[] };
          if (msg.type === 'SUBSCRIBE' && Array.isArray(msg.correlationIds)) {
            log('info', `[WS:${auth.tenantId}] SUBSCRIBE to ${msg.correlationIds.length} correlationId(s)`);
          }
        } catch { /* ignore malformed messages */ }
      });

      ws.on('close', () => {
        clearInterval(pingInterval);
        wsSessionManager.unregister(ws);
      });

      ws.send(JSON.stringify({
        type: 'CONNECTED',
        tenantId: auth.tenantId,
        timestamp: new Date().toISOString(),
        payload: {},
      }));

      log('info', `[WS] Client connected — tenant: ${auth.tenantId}, sessions: ${wsSessionManager.getSessionCount(auth.tenantId)}`);
    });
  });

  server.listen(PORT, () => {
    log('info', `Claw gateway listening on port ${PORT}`);
    log('info', 'Ready. Endpoints:');
    log('info', `  GET  http://localhost:${PORT}/health`);
    log('info', `  POST http://localhost:${PORT}/v1/messages  (JWT required)`);
    log('info', `  POST http://localhost:${PORT}/v1/approvals/:id  (JWT required)`);
    log('info', `  GET  http://localhost:${PORT}/v1/tenants/me  (JWT required)`);
    log('info', `  GET  http://localhost:${PORT}/v1/integrations  (JWT required)`);
    log('info', `  POST http://localhost:${PORT}/v1/devices  (JWT required — push token registration)`);
    log('info', `  WSS  ws://localhost:${PORT}/ws?token=<jwt>`);
    log('info', `  POST http://localhost:${PORT}/message  (legacy, default tenant)`);
    log('info', `  POST http://localhost:${PORT}/approval  (legacy, default tenant)`);
  });

  // ─── Graceful Shutdown ───
  const shutdown = (signal: string) => {
    log('info', `${signal} received — shutting down gracefully...`);
    // 1. Stop BullMQ workers (no new jobs start) + node-cron schedulers
    void tenantRegistry.stopAll().then(() => {
      // 2. Stop accepting new WS connections
      wss.close();
      // 3. Stop accepting new HTTP connections; wait for in-flight requests
      server.close(async () => {
        // 4. Close Redis connections
        if (redisClient) {
          await redisClient.quit().catch(() => {});
        }
        // 5. Close PG pool
        await closePool().catch(() => {});
        log('info', 'Gateway closed.');
        process.exit(0);
      });
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('uncaughtException', err => {
    log('error', 'Uncaught exception:', err);
  });
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────

function requireAuth(req: http.IncomingMessage): AuthContext {
  const auth = extractTenant(req);
  if (!auth) {
    throw new AuthError('Authentication required');
  }
  return auth;
}

// ─── OAuth Helpers ─────────────────────────────────────────────────────────────

function getAuthUrl(integrationId: string): string {
  switch (integrationId) {
    case 'gmail':
    case 'google_calendar':
    case 'google_drive':
      return 'https://accounts.google.com/o/oauth2/v2/auth';
    case 'hubspot':
      return 'https://app.hubspot.com/oauth/authorize';
    default:
      return '';
  }
}

function getTokenUrl(integrationId: string): string {
  switch (integrationId) {
    case 'gmail':
    case 'google_calendar':
    case 'google_drive':
      return 'https://oauth2.googleapis.com/token';
    case 'hubspot':
      return 'https://api.hubapi.com/oauth/v1/token';
    default:
      return '';
  }
}

function getScopes(integrationId: string): string[] {
  switch (integrationId) {
    case 'gmail':
      return ['https://mail.google.com/'];
    case 'google_calendar':
      return ['https://www.googleapis.com/auth/calendar'];
    case 'google_drive':
      return ['https://www.googleapis.com/auth/drive'];
    case 'hubspot':
      return ['crm.objects.contacts.read', 'crm.objects.contacts.write'];
    default:
      return [];
  }
}

async function setIntegrationEnabled(configPath: string, integrationId: string): Promise<void> {
  const raw = await fs.readFile(configPath, 'utf-8');
  const config = JSON.parse(raw) as { integrations: { id: string; enabled: boolean }[] };
  const entry = config.integrations.find(i => i.id === integrationId);
  if (entry) {
    entry.enabled = true;
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
  }
}

bootstrap().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
