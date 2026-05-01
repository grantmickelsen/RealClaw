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
import log from './utils/logger.js';
import { requestContext } from './utils/request-context.js';

import Redis from 'ioredis';
import { createLlmRouter } from './llm/factory.js';
import { MemoryManager } from './memory/memory-manager.js';
import { CredentialVault } from './credentials/vault.js';
import { createRateLimiter } from './middleware/rate-limiter.js';
import { AuditLogger } from './middleware/audit-logger.js';
import { HeartbeatScheduler } from './agents/ops/heartbeat.js';
import { BullMqHeartbeatScheduler, parseRedisUrl } from './agents/ops/bullmq-heartbeat.js';
import { registerBriefingJob, generateBriefingForTenant } from './agents/ops/briefing-job.js';
import { registerDealDeadlineMonitorJob } from './agents/ops/deal-deadline-monitor-job.js';
import { registerGmailIngestWorker } from './agents/ops/gmail-ingest-job.js';
import { registerGmailWatchJob } from './agents/ops/gmail-watch-job.js';
import { createToneAnalysisQueue, getToneAnalysisQueue, registerToneAnalysisWorker } from './agents/ops/tone-analysis-job.js';
import { createEventBus } from './agents/ops/redis-event-bus.js';
import { createDistributedLock } from './memory/distributed-lock.js';
import { createPushNotificationService } from './gateway/push-notification.js';
import type { PushNotificationService } from './gateway/push-notification.js';
import { upsertTenant } from './db/tenant-ops.js';
import { query, closePool } from './db/postgres.js';
import { Coordinator } from './coordinator/coordinator.js';
import { IntegrationManager } from './integrations/integration-manager.js';
import { TwilioIntegration } from './integrations/twilio.js';
import { IntegrationId } from './types/integrations.js';
import { bootstrapCredentialsFromEnv } from './setup/credential-bootstrap.js';
import { OAuthHandler } from './credentials/oauth-handler.js';
import { extractTenant } from './middleware/auth.js';
import type { AuthContext } from './middleware/auth.js';
import { AuthError } from './middleware/auth.js';
import { assertPlan } from './middleware/requirePlan.js';
import { verifyAppleIdentityToken } from './auth/apple-auth.js';
import { verifyGoogleIdentityToken } from './auth/google-auth.js';
import { issueTokenPair, rotateRefreshToken, revokeAllTokens, fetchSubscriptionClaims } from './auth/token-service.js';
import { handleRevenueCatWebhook } from './webhooks/revenuecat.js';
import { handleGmailWebhook, createGmailIngestQueue, getGmailIngestQueue } from './webhooks/gmail-webhook.js';
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
import { ShowingsAgent } from './agents/showings/showings-agent.js';

import { AGENT_CONFIGS, AgentId } from './types/agents.js';
import type { BaseAgent } from './agents/base-agent.js';
import type { InboundMessage, ApprovalResponse, ApprovalItem } from './types/messages.js';
import { normalizeInbound } from './utils/normalize.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = path.resolve(__dirname, '..', 'config');
const MODELS_CONFIG = process.env.CLAW_MODELS_CONFIG
  ? path.resolve(process.env.CLAW_MODELS_CONFIG)
  : path.join(CONFIG_DIR, 'models.json');
const HEARTBEAT_CONFIG = path.join(CONFIG_DIR, 'heartbeat.json');
const INTEGRATIONS_CONFIG = path.join(CONFIG_DIR, 'integrations.json');
const PORT = parseInt(process.env.OPENCLAW_GATEWAY_PORT ?? '18789', 10);
const OAUTH_REDIRECT_BASE = process.env.CLAW_OAUTH_REDIRECT_BASE ?? `http://localhost:${PORT}`;

// CSRF state store — maps state token → { integrationId, tenantId, expiresAt }
const oauthStateStore = new Map<string, { integrationId: string; tenantId: string; expiresAt: number }>();

// ─── Logging ─── (log imported from ./utils/logger.js above)

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

    log.info(`[TenantRegistry] Initializing tenant: ${tenantId}`);

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
    agentRegistry.set(AgentId.SHOWINGS,       makeAgent(ShowingsAgent,       AgentId.SHOWINGS));

    for (const agent of agentRegistry.values()) {
      agent.setAgentRegistry(agentRegistry);
      agent.setIntegrationManager(tenantIntegrationManager);
      if (this.wsSessionManager) agent.setWsPusher(this.wsSessionManager);
    }

    await Promise.all([...agentRegistry.values()].map(a => a.init()));
    log.info(`[TenantRegistry:${tenantId}] ${agentRegistry.size} agents ready`);

    // ─── Coordinator ───
    const queryFn = this.dbAvailable ? query : undefined;
    const coordinator = new Coordinator(tenantId, tenantMemoryPath, this.llmRouter, tenantAuditLogger, tenantEventBus, queryFn);
    await coordinator.init(CONFIG_DIR);

    for (const agent of agentRegistry.values()) {
      coordinator.registerDispatcher(agent);
    }

    // Seed auto-approval settings from DB so coordinator uses correct policy from first request
    if (this.dbAvailable) {
      try {
        const settingsRow = await query<{ auto_approval_settings: Record<string, string> }>(
          'SELECT auto_approval_settings FROM tenants WHERE tenant_id = $1',
          [tenantId],
        );
        coordinator.updateAutoApprovalSettings(settingsRow.rows[0]?.auto_approval_settings ?? {});
      } catch { /* non-critical — defaults to require-all */ }
    }

    coordinator.onSendMessage(async (platform, channelId, payload, correlationId) => {
      log.info(`[Outbound:${tenantId}] ${platform}/${channelId}: ${JSON.stringify(payload).slice(0, 200)}`);
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
            approvalId: ((payload as { approvalRequest?: { approvalId?: string } }).approvalRequest?.approvalId) ?? null,
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
      log.info(`[TenantRegistry:${tenantId}] Heartbeat: BullMQ loaded (${bullMqHb.listScheduled(tenantId).length} queue(s))`);
      heartbeat = bullMqHb;
    } else {
      // In-process node-cron heartbeat — for dev/single-instance deployments
      const cronHb = new HeartbeatScheduler();
      cronHb.onTrigger(trigger => coordinator.handleHeartbeat(trigger));
      if (heartbeatConfig) {
        cronHb.load(heartbeatConfig as Parameters<HeartbeatScheduler['load']>[0], tenantId);
        log.info(`[TenantRegistry:${tenantId}] Heartbeat: cron loaded (${cronHb.listScheduled().length} schedule(s))`);
      } else {
        log.warn(`[TenantRegistry:${tenantId}] No heartbeat config found — scheduled tasks disabled`);
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

const MAX_BODY_BYTES = 1_048_576; // 1 MB — enforced before JSON parsing

function readBodySafe(req: http.IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        req.destroy();
        reject(Object.assign(new Error('PAYLOAD_TOO_LARGE'), { statusCode: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function setSecurityHeaders(res: http.ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
}

// IP-based auth rate limiting — 20 attempts per IP per 15 min (blocks credential stuffing)
const AUTH_WINDOW_MS = 900_000;
const AUTH_MAX_ATTEMPTS = 20;
const authAttemptStore = new Map<string, number[]>();

function checkAuthRateLimit(req: http.IncomingMessage): boolean {
  const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
    ?? req.socket?.remoteAddress
    ?? 'unknown';
  const now = Date.now();
  const recent = (authAttemptStore.get(ip) ?? []).filter(t => now - t < AUTH_WINDOW_MS);
  if (recent.length >= AUTH_MAX_ATTEMPTS) return false;
  recent.push(now);
  authAttemptStore.set(ip, recent);
  // Periodic cleanup to prevent Map from growing unbounded
  if (authAttemptStore.size > 10_000) {
    for (const [k, v] of authAttemptStore) {
      if (v.every(t => now - t >= AUTH_WINDOW_MS)) authAttemptStore.delete(k);
    }
  }
  return true;
}

const FORMALITY_LABELS = ['Casual', 'Warm', 'Balanced', 'Professional', 'Formal'];

function buildTonePrefsMarkdown(prefs: Record<string, unknown>): string {
  const lines: string[] = ['## Stated Preferences\n'];
  if (typeof prefs['emailSalutation'] === 'string' && prefs['emailSalutation'])
    lines.push(`- Email greeting: "${prefs['emailSalutation']}"`);
  if (typeof prefs['textSalutation'] === 'string' && prefs['textSalutation'])
    lines.push(`- Text greeting: "${prefs['textSalutation']}"`);
  if (typeof prefs['formalityLevel'] === 'number')
    lines.push(`- Formality: ${FORMALITY_LABELS[prefs['formalityLevel'] as number] ?? 'Balanced'}`);
  if (typeof prefs['emojisInComms'] === 'boolean')
    lines.push(`- Emojis in client comms: ${prefs['emojisInComms'] ? 'Yes' : 'No'}`);
  if (typeof prefs['emojisInSocial'] === 'boolean')
    lines.push(`- Emojis in social posts: ${prefs['emojisInSocial'] ? 'Yes' : 'No'}`);
  if (typeof prefs['preferBullets'] === 'boolean')
    lines.push(`- Prefer bullet points: ${prefs['preferBullets'] ? 'Yes' : 'No'}`);

  const sample = typeof prefs['writingSample'] === 'string' ? prefs['writingSample'].trim() : '';
  if (sample) lines.push(`\n## Writing Sample\n\n${sample}`);

  return lines.join('\n');
}

async function bootstrap(): Promise<void> {
  log.info('Starting Claw gateway...');

  // ─── Core Services ───
  const memoryPath = process.env.CLAW_MEMORY_PATH ?? path.resolve(__dirname, '..', 'memory');
  const vault = new CredentialVault();

  const bootstrapResult = await bootstrapCredentialsFromEnv(vault);
  log.info(`Credential bootstrap: seeded=[${bootstrapResult.seeded.join(',')}]`);
  for (const f of bootstrapResult.failed) {
    log.warn(`Bootstrap failed ${f.id}: ${f.error}`);
  }

  // ─── WebSocket Session Manager + Cancellation Store ───
  const wsSessionManager = new WsSessionManager();
  const cancellationStore = createCancellationStore(process.env.REDIS_URL);

  // ─── Redis client (optional — enables distributed locking, event bus, BullMQ, rate limiting) ───
  let redisClient: Redis | undefined;
  if (process.env.REDIS_URL) {
    redisClient = new Redis(process.env.REDIS_URL);
    redisClient.on('error', (err: Error) => log.error('[Redis] Connection error', { error: err.message }));
    redisClient.on('connect', () => log.info('[Redis] Connected'));
    log.info(`[Redis] Configured — host: ${new URL(process.env.REDIS_URL).hostname}`);
  } else {
    log.info('[Redis] Not configured — using in-process fallbacks for locking, events, rate-limiting');
  }

  // ─── DB availability + push notification service ───
  const dbAvailable = !!process.env.DATABASE_URL;
  const pushService = dbAvailable ? createPushNotificationService(query) : null;
  if (pushService) {
    log.info('[Push] Push notification service enabled');
  }

  // ─── BullMQ connection (used for distributed heartbeat scheduler) ───
  const bullMqConnection = process.env.REDIS_URL ? parseRedisUrl(process.env.REDIS_URL) : undefined;
  if (bullMqConnection) {
    log.info('[BullMQ] Distributed heartbeat scheduling enabled');
  }

  log.info('Initializing LLM router...');
  const llmRouter = await createLlmRouter(MODELS_CONFIG, cancellationStore);

  log.info('Running LLM health checks...');
  const health = await llmRouter.healthCheckAll();
  for (const [provider, ok] of Object.entries(health)) {
    if (ok) {
      log.info(`  Provider ${provider}: OK`);
    } else {
      log.warn(`  Provider ${provider}: UNAVAILABLE`);
    }
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
  log.info(`Gateway ready — ${tenantRegistry.size()} tenant(s) initialized`);

  // ─── Overnight briefing job (BullMQ, requires Redis) ───
  let briefingJobCleanup: (() => Promise<void>) | undefined;
  if (bullMqConnection && dbAvailable) {
    const { queue: bq, worker: bw } = registerBriefingJob(bullMqConnection, llmRouter);
    briefingJobCleanup = async () => {
      await bw.close();
      await bq.close();
    };
  }

  // ─── Deal deadline monitor job (BullMQ, daily at 7 AM UTC) ───
  let dealJobCleanup: (() => Promise<void>) | undefined;
  if (bullMqConnection && dbAvailable) {
    const { queue: dq, worker: dw } = registerDealDeadlineMonitorJob(bullMqConnection, wsSessionManager);
    dealJobCleanup = async () => {
      await dw.close();
      await dq.close();
    };
  }

  // ─── Gmail ingest queue + worker (BullMQ, triggered by Pub/Sub webhook) ───
  if (bullMqConnection) {
    createGmailIngestQueue(bullMqConnection);
  }
  let gmailIngestCleanup: (() => Promise<void>) | undefined;
  if (bullMqConnection && dbAvailable) {
    const dispatchEmailIngest = async (tenantId: string, emailRow: Record<string, unknown>) => {
      const coordinator = await tenantRegistry.getOrCreate(tenantId);
      const correlationId = uuidv4();
      const msg = normalizeInbound('mobile', {
        text: '',
        channelId: 'gmail',
        userId: tenantId,
        username: 'gmail-ingest',
        correlationId,
        structuredData: { taskType: 'email_ingest', emailRow },
      });
      await coordinator.handleInbound(msg);
    };
    const gmailWorker = registerGmailIngestWorker(bullMqConnection, vault, dispatchEmailIngest);
    gmailIngestCleanup = async () => { await gmailWorker.close(); };
  }

  // ─── Gmail watch renewal job (BullMQ, daily at 9 AM UTC) ───
  let gmailWatchCleanup: (() => Promise<void>) | undefined;
  if (bullMqConnection && dbAvailable) {
    const { queue: gwq, worker: gww } = registerGmailWatchJob(bullMqConnection, vault);
    gmailWatchCleanup = async () => {
      await gww.close();
      await gwq.close();
    };
  }

  // ─── Tone analysis worker (BullMQ, triggered on-demand by user) ─────────
  if (bullMqConnection) {
    createToneAnalysisQueue(bullMqConnection);
  }
  let toneAnalysisCleanup: (() => Promise<void>) | undefined;
  if (bullMqConnection && dbAvailable) {
    const memPath = process.env.CLAW_MEMORY_PATH ?? path.resolve('./memory');
    const toneWorker = registerToneAnalysisWorker(bullMqConnection, vault, llmRouter, memPath);
    toneAnalysisCleanup = async () => { await toneWorker.close(); };
  }

  // ─── Gateway HTTP Server ───
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Tenant-Id');

    // Security headers — applied to every response
    setSecurityHeaders(res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // ─── GET /health/live — K8s liveness probe (never calls external deps) ───
    if (req.method === 'GET' && url.pathname === '/health/live') {
      sendJson(res, 200, { ok: true, uptime: Math.floor(process.uptime()) });
      return;
    }

    // ─── GET /health/ready — K8s readiness probe (checks DB + Redis + LLM) ───
    if (req.method === 'GET' && url.pathname === '/health/ready') {
      const checks: Record<string, boolean> = {};
      try { await query('SELECT 1'); checks['postgres'] = true; }
      catch { checks['postgres'] = false; }
      try {
        if (redisClient) { await redisClient.ping(); }
        checks['redis'] = true;
      } catch { checks['redis'] = false; }
      const llmHealth = await llmRouter.healthCheckAll();
      checks['llm'] = Object.values(llmHealth).some(Boolean);
      const ready = Object.values(checks).every(Boolean);
      sendJson(res, ready ? 200 : 503, { ready, checks });
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

    // ─── POST /v1/auth/apple ─────────────────────────────────────────────────
    if (req.method === 'POST' && url.pathname === '/v1/auth/apple') {
      if (!checkAuthRateLimit(req)) {
        sendJson(res, 429, { error: 'Too many authentication attempts. Try again in 15 minutes.' });
        return;
      }
      try {
        const body = JSON.parse(await readBodySafe(req)) as {
          identityToken?: string;
          fullName?: { givenName?: string; familyName?: string };
        };
        const clientId = process.env.APPLE_CLIENT_ID;
        if (!clientId) { sendJson(res, 503, { error: 'Apple auth not configured' }); return; }
        if (!body.identityToken) { sendJson(res, 400, { error: 'identityToken required' }); return; }

        const payload = await verifyAppleIdentityToken(body.identityToken, clientId);
        await upsertTenant(payload.sub);

        const userResult = await query<{ user_id: string }>(
          `INSERT INTO tenant_users (tenant_id, apple_sub, email, display_name)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (apple_sub) DO UPDATE
             SET email = COALESCE(EXCLUDED.email, tenant_users.email),
                 display_name = COALESCE(EXCLUDED.display_name, tenant_users.display_name)
           RETURNING user_id`,
          [
            payload.sub,
            payload.sub,
            payload.email ?? null,
            body.fullName
              ? `${body.fullName.givenName ?? ''} ${body.fullName.familyName ?? ''}`.trim() || null
              : null,
          ],
        );
        const userId = userResult.rows[0]?.user_id;
        if (!userId) { sendJson(res, 500, { error: 'User creation failed' }); return; }

        const tokens = await issueTokenPair(payload.sub, userId);
        sendJson(res, 200, tokens);
      } catch (err) {
        sendJson(res, 401, { error: (err as Error).message });
      }
      return;
    }

    // ─── POST /v1/auth/google ─────────────────────────────────────────────────
    if (req.method === 'POST' && url.pathname === '/v1/auth/google') {
      if (!checkAuthRateLimit(req)) {
        sendJson(res, 429, { error: 'Too many authentication attempts. Try again in 15 minutes.' });
        return;
      }
      try {
        const body = JSON.parse(await readBodySafe(req)) as { idToken?: string };
        const clientId = process.env.GOOGLE_CLIENT_ID;
        if (!clientId) { sendJson(res, 503, { error: 'Google auth not configured' }); return; }
        if (!body.idToken) { sendJson(res, 400, { error: 'idToken required' }); return; }

        const payload = await verifyGoogleIdentityToken(body.idToken, clientId);
        await upsertTenant(payload.sub);

        const userResult = await query<{ user_id: string }>(
          `INSERT INTO tenant_users (tenant_id, google_sub, email, display_name)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (google_sub) DO UPDATE
             SET email = EXCLUDED.email,
                 display_name = COALESCE(EXCLUDED.display_name, tenant_users.display_name)
           RETURNING user_id`,
          [payload.sub, payload.sub, payload.email, payload.name ?? null],
        );
        const userId = userResult.rows[0]?.user_id;
        if (!userId) { sendJson(res, 500, { error: 'User creation failed' }); return; }

        const tokens = await issueTokenPair(payload.sub, userId);
        sendJson(res, 200, tokens);
      } catch (err) {
        sendJson(res, 401, { error: (err as Error).message });
      }
      return;
    }

    // ─── POST /v1/auth/refresh ────────────────────────────────────────────────
    if (req.method === 'POST' && url.pathname === '/v1/auth/refresh') {
      if (!checkAuthRateLimit(req)) {
        sendJson(res, 429, { error: 'Too many authentication attempts. Try again in 15 minutes.' });
        return;
      }
      try {
        const body = JSON.parse(await readBodySafe(req)) as { refreshToken?: string };
        if (!body.refreshToken) { sendJson(res, 400, { error: 'refreshToken required' }); return; }
        const tokens = await rotateRefreshToken(body.refreshToken);
        if (!tokens) { sendJson(res, 401, { error: 'Invalid or expired refresh token' }); return; }
        sendJson(res, 200, tokens);
      } catch (err) {
        sendJson(res, 500, { error: (err as Error).message });
      }
      return;
    }

    // ─── POST /v1/auth/revoke ─────────────────────────────────────────────────
    if (req.method === 'POST' && url.pathname === '/v1/auth/revoke') {
      let auth: AuthContext;
      try {
        auth = requireAuth(req);
      } catch {
        sendJson(res, 401, { error: 'Unauthorized' });
        return;
      }
      await revokeAllTokens(auth.userId);
      sendJson(res, 200, { ok: true });
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
        body = await readBodySafe(req);
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode === 413 ? 413 : 400;
        sendJson(res, status, { ok: false, error: (err as Error).message === 'PAYLOAD_TOO_LARGE' ? 'Request body too large (max 1MB)' : 'Failed to read request body' });
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
          log.error(`[Gateway] Async message error for ${tenantId}/${correlationId}`, { error: (err as Error).message });
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

    // ─── GET /v1/approvals/:approvalId (JWT required) ───
    if (req.method === 'GET' && url.pathname.startsWith('/v1/approvals/')) {
      let auth: AuthContext;
      try {
        auth = requireAuth(req);
      } catch (err) {
        sendJson(res, 401, { ok: false, error: (err as Error).message });
        return;
      }
      const approvalId = decodeURIComponent(url.pathname.slice('/v1/approvals/'.length));
      const coordinator = await tenantRegistry.getOrCreate(auth.tenantId);
      const request = coordinator.approvalManager.getApproval(approvalId);
      if (!request) {
        sendJson(res, 404, { ok: false, error: 'Approval not found or already resolved' });
        return;
      }
      sendJson(res, 200, {
        approvalId: request.approvalId,
        items: request.batch,
        expiresAt: request.expiresAt,
        status: 'pending',
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
        const body = await readBodySafe(req);
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

    // ─── GET /v1/preferences (JWT required) ─────────────────────────────────
    if (req.method === 'GET' && url.pathname === '/v1/preferences') {
      let auth: AuthContext;
      try {
        auth = requireAuth(req);
      } catch (err) {
        sendJson(res, 401, { ok: false, error: (err as Error).message });
        return;
      }
      if (!dbAvailable) {
        sendJson(res, 503, { ok: false, error: 'Database not available' });
        return;
      }
      const row = await query<{
        primary_zip: string | null;
        display_name: string | null;
        brokerage: string | null;
        phone: string | null;
        llm_tier: string;
        tone_prefs: Record<string, unknown>;
        onboarding_done: boolean;
        tone_analyzed_at: string | null;
        auto_approval_settings: Record<string, string>;
      }>(
        'SELECT primary_zip, display_name, brokerage, phone, llm_tier, tone_prefs, onboarding_done, tone_analyzed_at, auto_approval_settings FROM tenants WHERE tenant_id = $1',
        [auth.tenantId],
      );
      const t = row.rows[0];
      sendJson(res, 200, {
        primaryZip: t?.primary_zip ?? null,
        displayName: t?.display_name ?? null,
        brokerage: t?.brokerage ?? null,
        phone: t?.phone ?? null,
        llmTier: t?.llm_tier ?? 'balanced',
        tonePrefs: t?.tone_prefs ?? {},
        onboardingDone: t?.onboarding_done ?? false,
        toneAnalyzedAt: t?.tone_analyzed_at ?? null,
        autoApprovalSettings: t?.auto_approval_settings ?? {},
      });
      return;
    }

    // ─── PUT /v1/preferences (JWT required) ─────────────────────────────────
    if (req.method === 'PUT' && url.pathname === '/v1/preferences') {
      let auth: AuthContext;
      try {
        auth = requireAuth(req);
      } catch (err) {
        sendJson(res, 401, { ok: false, error: (err as Error).message });
        return;
      }
      if (!dbAvailable) {
        sendJson(res, 503, { ok: false, error: 'Database not available' });
        return;
      }
      let body: string;
      try {
        body = await readBodySafe(req);
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode === 413 ? 413 : 400;
        sendJson(res, status, { ok: false, error: 'Failed to read request body' });
        return;
      }
      const updates = JSON.parse(body) as {
        primaryZip?: string;
        displayName?: string;
        brokerage?: string;
        phone?: string;
        llmTier?: string;
        tonePrefs?: Record<string, unknown>;
        onboardingDone?: boolean;
        autoApprovalSettings?: Record<string, string>;
      };
      if (updates.primaryZip !== undefined && !/^\d{5}$/.test(updates.primaryZip)) {
        sendJson(res, 400, { ok: false, error: 'primaryZip must be a 5-digit ZIP code' });
        return;
      }
      if (updates.llmTier !== undefined && !['fast', 'balanced', 'best'].includes(updates.llmTier)) {
        sendJson(res, 400, { ok: false, error: 'llmTier must be fast, balanced, or best' });
        return;
      }
      // Build dynamic SET clause from provided fields only
      const setClauses: string[] = [];
      const values: unknown[] = [];
      const fieldMap: Record<string, string> = {
        primaryZip: 'primary_zip',
        displayName: 'display_name',
        brokerage: 'brokerage',
        phone: 'phone',
        llmTier: 'llm_tier',
        tonePrefs: 'tone_prefs',
        onboardingDone: 'onboarding_done',
        autoApprovalSettings: 'auto_approval_settings',
      };
      for (const [jsKey, dbCol] of Object.entries(fieldMap)) {
        if (jsKey in updates) {
          values.push((updates as Record<string, unknown>)[jsKey]);
          setClauses.push(`${dbCol} = $${values.length}`);
        }
      }
      if (setClauses.length === 0) {
        sendJson(res, 200, { ok: true });
        return;
      }
      values.push(auth.tenantId);
      await query(
        `UPDATE tenants SET ${setClauses.join(', ')} WHERE tenant_id = $${values.length}`,
        values,
      );
      // Write tone-prefs.md to memory so CommsAgent can merge it into its tone model
      if (updates.tonePrefs) {
        try {
          const memPath = process.env.CLAW_MEMORY_PATH ?? path.resolve('./memory');
          const tonePrefsPath = path.join(memPath, auth.tenantId, 'client-profile', 'tone-prefs.md');
          await fs.mkdir(path.dirname(tonePrefsPath), { recursive: true });
          await fs.writeFile(tonePrefsPath, buildTonePrefsMarkdown(updates.tonePrefs), 'utf-8');
        } catch { /* non-critical */ }
      }
      // Push auto-approval settings to coordinator so behavior changes immediately (no restart needed)
      if (updates.autoApprovalSettings) {
        try {
          const coordinator = await tenantRegistry.getOrCreate(auth.tenantId);
          coordinator.updateAutoApprovalSettings(updates.autoApprovalSettings);
        } catch { /* non-critical */ }
      }
      sendJson(res, 200, { ok: true });
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
        body = await readBodySafe(req);
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode === 413 ? 413 : 400;
        sendJson(res, status, { ok: false, error: (err as Error).message === 'PAYLOAD_TOO_LARGE' ? 'Request body too large (max 1MB)' : 'Failed to read request body' });
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

    // ─── POST /v1/contacts (JWT required) ────────────────────────────────────
    if (req.method === 'POST' && url.pathname === '/v1/contacts') {
      let auth: AuthContext;
      try {
        auth = requireAuth(req);
      } catch (err) {
        sendJson(res, 401, { ok: false, error: (err as Error).message });
        return;
      }
      const contactBody = await readBodySafe(req);
      const {
        name, email, phone, stage, source,
        budget, desiredLocation, bedBath, timeline, notes,
      } = JSON.parse(contactBody) as {
        name?: string; email?: string; phone?: string;
        stage?: string; source?: string; budget?: string;
        desiredLocation?: string; bedBath?: string; timeline?: string; notes?: string;
      };
      if (!name?.trim()) {
        sendJson(res, 400, { ok: false, error: 'name is required' });
        return;
      }
      const contactId = email
        ? email.replace(/[^a-z0-9]/gi, '-').toLowerCase()
        : `manual-${Date.now()}`;
      const lines: string[] = [
        `# Contact: ${name.trim()}`,
        '',
        '## Overview',
        `- **Name:** ${name.trim()}`,
      ];
      if (email)           lines.push(`- **Email:** ${email}`);
      if (phone)           lines.push(`- **Phone:** ${phone}`);
      if (stage)           lines.push(`- **Stage:** ${stage}`);
      if (source)          lines.push(`- **Source:** ${source}`);
      if (budget || desiredLocation || bedBath) {
        lines.push('', '## Buying Criteria');
        if (budget)          lines.push(`- **Budget:** ${budget}`);
        if (desiredLocation) lines.push(`- **Location:** ${desiredLocation}`);
        if (bedBath)         lines.push(`- **Bed/Bath:** ${bedBath}`);
      }
      if (timeline) {
        lines.push('', '## Timeline', `- **Timeline:** ${timeline}`);
      }
      if (notes?.trim()) {
        lines.push('', '## Notes', notes.trim());
      }
      lines.push('', '## Interaction History', `- Manually added on ${new Date().toISOString()}`);
      lines.push('', `<!-- written-by: ${AgentId.RELATIONSHIP} -->`);
      const content = lines.join('\n');
      try {
        const tenantMemory = new MemoryManager(memoryPath, auth.tenantId);
        await tenantMemory.write({
          path: `contacts/${contactId}.md`,
          operation: 'create',
          content,
          writtenBy: AgentId.RELATIONSHIP,
        });
        if (dbAvailable) {
          await query(
            `INSERT INTO contacts (id, tenant_id, name, email, phone, stage, source, budget,
              desired_location, bed_bath, timeline, notes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
             ON CONFLICT (tenant_id, id) DO UPDATE SET
               name=EXCLUDED.name, email=EXCLUDED.email, phone=EXCLUDED.phone,
               stage=EXCLUDED.stage, source=EXCLUDED.source, budget=EXCLUDED.budget,
               desired_location=EXCLUDED.desired_location, bed_bath=EXCLUDED.bed_bath,
               timeline=EXCLUDED.timeline, notes=EXCLUDED.notes`,
            [contactId, auth.tenantId, name!.trim(), email ?? null, phone ?? null,
             stage ?? null, source ?? null, budget ?? null,
             desiredLocation ?? null, bedBath ?? null, timeline ?? null,
             notes ?? null],
          );
        }
        sendJson(res, 201, { ok: true, contactId });
      } catch (err) {
        log.error('[POST /v1/contacts] write failed', { error: String(err) });
        sendJson(res, 500, { ok: false, error: 'Failed to create contact' });
      }
      return;
    }

    // ─── GET /v1/contacts (JWT required) ─────────────────────────────────────
    if (req.method === 'GET' && url.pathname === '/v1/contacts') {
      let auth: AuthContext;
      try {
        auth = requireAuth(req);
      } catch (err) {
        sendJson(res, 401, { ok: false, error: (err as Error).message });
        return;
      }
      if (!dbAvailable) {
        sendJson(res, 200, { contacts: [] });
        return;
      }
      const contactRows = await query<{
        contact_id: string; max_score: number; summary_text: string | null; type: string | null;
        name: string | null; email: string | null; phone: string | null;
        stage: string | null; source: string | null; budget: string | null; timeline: string | null;
      }>(
        // Contacts-first: always shows manually-added contacts even with no briefing_items row.
        // UNION includes legacy briefing-only contacts (before the contacts table existed).
        `SELECT q.contact_id, q.max_score, q.summary_text, q.type,
                q.name, q.email, q.phone, q.stage, q.source, q.budget, q.timeline
         FROM (
           -- Structured contacts (contacts table is source of truth)
           SELECT c.id                                        AS contact_id,
                  COALESCE(s.max_score, 0)                   AS max_score,
                  COALESCE(l.summary_text, 'Contact added')  AS summary_text,
                  COALESCE(l.type, 'contact')                AS type,
                  c.name, c.email, c.phone, c.stage, c.source, c.budget, c.timeline
           FROM contacts c
           LEFT JOIN LATERAL (
             SELECT MAX(urgency_score) AS max_score
             FROM briefing_items
             WHERE tenant_id = $1 AND contact_id::text = c.id AND dismissed_at IS NULL
           ) s ON true
           LEFT JOIN LATERAL (
             SELECT summary_text, type
             FROM briefing_items
             WHERE tenant_id = $1 AND contact_id::text = c.id AND dismissed_at IS NULL
             ORDER BY urgency_score DESC, created_at DESC
             LIMIT 1
           ) l ON true
           WHERE c.tenant_id = $1

           UNION ALL

           -- Legacy: briefing_items contacts that pre-date the contacts table
           SELECT bi.contact_id::text                        AS contact_id,
                  MAX(bi.urgency_score)                      AS max_score,
                  MAX(bi.summary_text)                       AS summary_text,
                  MAX(bi.type)                               AS type,
                  NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text
           FROM briefing_items bi
           LEFT JOIN contacts c
             ON c.id = bi.contact_id::text AND c.tenant_id = bi.tenant_id
           WHERE bi.tenant_id = $1
             AND bi.contact_id IS NOT NULL
             AND bi.dismissed_at IS NULL
             AND c.id IS NULL
           GROUP BY bi.contact_id
         ) q
         ORDER BY q.max_score DESC`,
        [auth.tenantId],
      );
      sendJson(res, 200, {
        contacts: contactRows.rows.map(r => ({
          id: r.contact_id,
          temperatureScore: r.max_score * 10,
          nextAction: r.summary_text ?? 'Contact added',
          contactType: r.type ?? 'contact',
          name: r.name ?? null,
          email: r.email ?? null,
          phone: r.phone ?? null,
          stage: r.stage ?? null,
          source: r.source ?? null,
          budget: r.budget ?? null,
          timeline: r.timeline ?? null,
        })),
      });
      return;
    }

    // ─── GET /v1/briefing (JWT required) ─────────────────────────────────────
    if (req.method === 'GET' && url.pathname === '/v1/briefing') {
      let auth: AuthContext;
      try {
        auth = requireAuth(req);
      } catch (err) {
        sendJson(res, 401, { ok: false, error: (err as Error).message });
        return;
      }
      if (!dbAvailable) {
        sendJson(res, 200, { items: [] });
        return;
      }
      const briefingRows = await query<{
        id: string; type: string; urgency_score: number; summary_text: string;
        draft_content: string | null; draft_medium: string | null;
        suggested_action: string | null; contact_id: string | null; created_at: string;
      }>(
        `SELECT id, type, urgency_score, summary_text, draft_content, draft_medium,
                suggested_action, contact_id, created_at
         FROM briefing_items
         WHERE tenant_id = $1 AND dismissed_at IS NULL
           AND created_at >= NOW() - INTERVAL '24 hours'
         ORDER BY urgency_score DESC, created_at DESC`,
        [auth.tenantId],
      );
      sendJson(res, 200, {
        items: briefingRows.rows.map(r => ({
          id: r.id,
          type: r.type,
          urgencyScore: r.urgency_score,
          summaryText: r.summary_text,
          draftContent: r.draft_content,
          draftMedium: r.draft_medium,
          suggestedAction: r.suggested_action,
          contactId: r.contact_id,
          createdAt: r.created_at,
        })),
      });
      return;
    }

    // ─── DELETE /v1/briefing/:id (JWT required) ───────────────────────────────
    if (req.method === 'DELETE' && url.pathname.startsWith('/v1/briefing/') && !url.pathname.endsWith('/approve')) {
      let auth: AuthContext;
      try {
        auth = requireAuth(req);
      } catch (err) {
        sendJson(res, 401, { ok: false, error: (err as Error).message });
        return;
      }
      const briefingIdDel = decodeURIComponent(url.pathname.slice('/v1/briefing/'.length));
      if (dbAvailable) {
        await query(
          'UPDATE briefing_items SET dismissed_at = NOW() WHERE id = $1 AND tenant_id = $2',
          [briefingIdDel, auth.tenantId],
        );
      }
      sendJson(res, 200, { ok: true });
      return;
    }

    // ─── POST /v1/briefing/regenerate (JWT required) ──────────────────────────
    if (req.method === 'POST' && url.pathname === '/v1/briefing/regenerate') {
      let auth: AuthContext;
      try {
        auth = requireAuth(req);
      } catch (err) {
        sendJson(res, 401, { ok: false, error: (err as Error).message });
        return;
      }
      sendJson(res, 202, { ok: true });
      setImmediate(async () => {
        try {
          await generateBriefingForTenant(auth.tenantId, llmRouter);
        } catch (err) {
          log.error(`[Briefing:regenerate] Error for ${auth.tenantId}`, { error: (err as Error).message });
        }
      });
      return;
    }

    // ─── POST /v1/briefing/:id/approve (JWT required) ─────────────────────────
    if (req.method === 'POST' && url.pathname.startsWith('/v1/briefing/') && url.pathname.endsWith('/approve')) {
      let auth: AuthContext;
      try {
        auth = requireAuth(req);
      } catch (err) {
        sendJson(res, 401, { ok: false, error: (err as Error).message });
        return;
      }
      if (!dbAvailable) {
        sendJson(res, 503, { ok: false, error: 'Database not available' });
        return;
      }
      const briefingIdApprove = decodeURIComponent(
        url.pathname.slice('/v1/briefing/'.length, -'/approve'.length),
      );
      const briefingRow = await query<{
        summary_text: string; draft_content: string | null;
        suggested_action: string | null; draft_medium: string | null;
        contact_id: string | null;
      }>(
        'SELECT summary_text, draft_content, suggested_action, draft_medium, contact_id FROM briefing_items WHERE id = $1 AND tenant_id = $2',
        [briefingIdApprove, auth.tenantId],
      );
      if (!briefingRow.rows[0]) {
        sendJson(res, 404, { ok: false, error: 'Briefing item not found' });
        return;
      }
      const bItem = briefingRow.rows[0];

      // Map briefing item fields to approval action type
      const medium = (bItem.draft_medium as string | null) ?? 'sms';
      const suggestedAction = (bItem.suggested_action as string | null) ?? '';
      let actionType: ApprovalItem['actionType'] = 'send_sms';
      if (medium === 'email' || suggestedAction.includes('email')) {
        actionType = 'send_email';
      }

      const approvalItem: ApprovalItem = {
        index: 0,
        actionType,
        preview: ((bItem.draft_content as string | null) ?? (bItem.summary_text as string)).slice(0, 200),
        fullContent: (bItem.draft_content as string | null) ?? (bItem.summary_text as string),
        medium,
        recipients: (bItem.contact_id as string | null) ? [(bItem.contact_id as string)] : [],
        originatingAgent: AgentId.COMMS,
        taskResultId: uuidv4(),
      };

      try {
        const coordinator = await tenantRegistry.getOrCreate(auth.tenantId);
        const approvalRequest = await coordinator.approvalManager.createApprovalRequest([approvalItem]);
        const approvalCorrelationId = uuidv4();

        // Push TASK_COMPLETE so the WS handler also navigates (belt-and-suspenders)
        wsSessionManager.push(auth.tenantId, {
          type: 'TASK_COMPLETE',
          correlationId: approvalCorrelationId,
          tenantId: auth.tenantId,
          timestamp: new Date().toISOString(),
          payload: {
            text: 'Action queued for approval.',
            agentId: AgentId.COMMS,
            processingMs: 0,
            hasApproval: true,
            approvalId: approvalRequest.approvalId,
            source: 'briefing',
          },
        });

        sendJson(res, 200, { ok: true, approvalId: approvalRequest.approvalId });
      } catch (err) {
        log.error(`[Briefing:approve] Error for ${auth.tenantId}`, { error: (err as Error).message });
        sendJson(res, 500, { ok: false, error: 'Failed to create approval' });
      }
      return;
    }

    // ─── GET /v1/integrations/gmail/status (JWT required) ────────────────────
    if (req.method === 'GET' && url.pathname === '/v1/integrations/gmail/status') {
      let auth: AuthContext;
      try { auth = requireAuth(req); } catch (err) {
        sendJson(res, 401, { ok: false, error: (err as Error).message }); return;
      }
      if (!dbAvailable) { sendJson(res, 200, { connected: false, gmailAddress: null }); return; }
      try {
        const row = await query<{ gmail_address: string; revoked_at: string | null }>(
          'SELECT gmail_address, revoked_at FROM tenant_gmail_auth WHERE tenant_id = $1',
          [auth.tenantId],
        );
        const rec = row.rows[0];
        sendJson(res, 200, {
          connected: !!rec && !rec.revoked_at,
          gmailAddress: rec && !rec.revoked_at ? rec.gmail_address : null,
        });
      } catch (err) {
        log.error('[Gmail:status] DB error', { error: (err as Error).message });
        sendJson(res, 500, { ok: false });
      }
      return;
    }

    // ─── DELETE /v1/integrations/gmail (JWT required) ─────────────────────────
    if (req.method === 'DELETE' && url.pathname === '/v1/integrations/gmail') {
      let auth: AuthContext;
      try { auth = requireAuth(req); } catch (err) {
        sendJson(res, 401, { ok: false, error: (err as Error).message }); return;
      }
      try {
        // Revoke tokens from vault
        await vault.delete('gmail' as never, 'access_token', auth.tenantId);
        await vault.delete('gmail' as never, 'refresh_token', auth.tenantId);
        await vault.delete('gmail' as never, 'expires_at', auth.tenantId);
        // Stamp revoked_at and delete watch record
        if (dbAvailable) {
          await query(
            'UPDATE tenant_gmail_auth SET revoked_at = NOW() WHERE tenant_id = $1',
            [auth.tenantId],
          );
          await query('DELETE FROM gmail_watches WHERE tenant_id = $1', [auth.tenantId]);
        }
        sendJson(res, 200, { ok: true });
      } catch (err) {
        log.error('[Gmail:revoke] Error', { error: (err as Error).message });
        sendJson(res, 500, { ok: false });
      }
      return;
    }

    // ─── POST /v1/integrations/gmail/analyze-tone (JWT required) ─────────────
    if (req.method === 'POST' && url.pathname === '/v1/integrations/gmail/analyze-tone') {
      let auth: AuthContext;
      try {
        auth = requireAuth(req);
      } catch (err) {
        sendJson(res, 401, { ok: false, error: (err as Error).message });
        return;
      }
      if (!dbAvailable) {
        sendJson(res, 503, { ok: false, error: 'Database not available' });
        return;
      }
      const gmailRow = await query<{ gmail_address: string }>(
        'SELECT gmail_address FROM tenant_gmail_auth WHERE tenant_id = $1 AND revoked_at IS NULL',
        [auth.tenantId],
      );
      if (!gmailRow.rows[0]) {
        sendJson(res, 400, { error: 'Gmail not connected' });
        return;
      }
      const cooldownRow = await query<{ tone_analyzed_at: string | null }>(
        'SELECT tone_analyzed_at FROM tenants WHERE tenant_id = $1',
        [auth.tenantId],
      );
      const last = cooldownRow.rows[0]?.tone_analyzed_at;
      if (last && Date.now() - new Date(last).getTime() < 6 * 60 * 60 * 1000) {
        sendJson(res, 429, { error: 'Tone analysis ran recently — try again in a few hours' });
        return;
      }
      const toneQueue = getToneAnalysisQueue();
      if (!toneQueue) {
        sendJson(res, 503, { error: 'Tone analysis service unavailable' });
        return;
      }
      await toneQueue.add('tone-analysis', { tenantId: auth.tenantId }, { attempts: 2, removeOnComplete: true });
      sendJson(res, 202, { ok: true });
      return;
    }

    // ─── GET /v1/paperwork/catalog ────────────────────────────────────────────
    if (req.method === 'GET' && url.pathname === '/v1/paperwork/catalog') {
      let auth: AuthContext;
      try {
        auth = requireAuth(req);
      } catch (err) {
        sendJson(res, 401, { ok: false, error: (err as Error).message });
        return;
      }
      void auth; // auth validated — catalog is same for all tenants
      try {
        const raw = await fs.readFile(path.join(CONFIG_DIR, 'paperwork-catalog.json'), 'utf-8');
        sendJson(res, 200, JSON.parse(raw));
      } catch {
        sendJson(res, 500, { error: 'Catalog unavailable' });
      }
      return;
    }

    // ─── POST /v1/paperwork/send (JWT required) ───────────────────────────────
    if (req.method === 'POST' && url.pathname === '/v1/paperwork/send') {
      let auth: AuthContext;
      try {
        auth = requireAuth(req);
      } catch (err) {
        sendJson(res, 401, { ok: false, error: (err as Error).message });
        return;
      }

      let body: { documentIds?: string[]; contactId?: string; note?: string };
      try {
        body = JSON.parse(await readBodySafe(req)) as typeof body;
      } catch {
        sendJson(res, 400, { error: 'Invalid request body' });
        return;
      }

      const { documentIds = [], contactId = '', note = '' } = body;
      if (documentIds.length === 0 || !contactId) {
        sendJson(res, 400, { error: 'documentIds and contactId are required' });
        return;
      }

      try {
        // Load catalog to resolve document labels
        const catalogRaw = await fs.readFile(path.join(CONFIG_DIR, 'paperwork-catalog.json'), 'utf-8');
        const catalog = JSON.parse(catalogRaw) as { id: string; label: string }[];
        const catalogMap = new Map(catalog.map(d => [d.id, d.label]));

        const approvalItems: ApprovalItem[] = documentIds.map((docId, i) => ({
          index: i,
          actionType: 'send_document',
          preview: `Send ${catalogMap.get(docId) ?? docId} to client`,
          medium: 'email',
          recipients: [contactId],
          fullContent: note,
          originatingAgent: AgentId.CONTENT,
          taskResultId: uuidv4(),
        }));

        const coordinator = await tenantRegistry.getOrCreate(auth.tenantId);
        const approvalRequest = await coordinator.approvalManager.createApprovalRequest(approvalItems);
        sendJson(res, 202, { approvalId: approvalRequest.approvalId });
      } catch (err) {
        log.error('[Paperwork:send] Error', { error: (err as Error).message });
        sendJson(res, 500, { error: 'Failed to create approval' });
      }
      return;
    }

    // ─── GET /v1/open-house/guests (JWT required) ─────────────────────────────
    if (req.method === 'GET' && url.pathname === '/v1/open-house/guests') {
      let auth: AuthContext;
      try {
        auth = requireAuth(req);
      } catch (err) {
        sendJson(res, 401, { ok: false, error: (err as Error).message });
        return;
      }
      if (!dbAvailable) {
        sendJson(res, 200, { guests: [] });
        return;
      }
      const guestRows = await query<{
        id: string; name: string; phone: string | null;
        working_with_agent: boolean; brain_dump_text: string | null; created_at: string;
      }>(
        `SELECT id, name, phone, working_with_agent, brain_dump_text, created_at
         FROM open_house_guests WHERE tenant_id = $1 AND open_house_date = CURRENT_DATE
         ORDER BY created_at DESC`,
        [auth.tenantId],
      );
      sendJson(res, 200, {
        guests: guestRows.rows.map(g => ({
          id: g.id,
          name: g.name,
          phone: g.phone,
          workingWithAgent: g.working_with_agent,
          brainDumpText: g.brain_dump_text,
          createdAt: g.created_at,
        })),
      });
      return;
    }

    // ─── POST /v1/open-house/guests (JWT required) ────────────────────────────
    if (req.method === 'POST' && url.pathname === '/v1/open-house/guests') {
      let auth: AuthContext;
      try {
        auth = requireAuth(req);
      } catch (err) {
        sendJson(res, 401, { ok: false, error: (err as Error).message });
        return;
      }
      if (!dbAvailable) {
        sendJson(res, 503, { ok: false, error: 'Database not available' });
        return;
      }
      let ohGuestBody: string;
      try {
        ohGuestBody = await readBodySafe(req);
      } catch {
        sendJson(res, 400, { ok: false, error: 'Failed to read request body' });
        return;
      }
      const { name: guestName, phone: guestPhone, workingWithAgent, brainDumpText } = JSON.parse(ohGuestBody) as {
        name?: string; phone?: string; workingWithAgent?: boolean; brainDumpText?: string;
      };
      if (!guestName?.trim()) {
        sendJson(res, 400, { ok: false, error: 'name is required' });
        return;
      }
      const insertedGuest = await query<{ id: string }>(
        `INSERT INTO open_house_guests (tenant_id, name, phone, working_with_agent, brain_dump_text, knowledge_enriched)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [auth.tenantId, guestName.trim(), guestPhone ?? null, workingWithAgent ?? false,
         brainDumpText ?? null, !!brainDumpText],
      );
      const guestId = insertedGuest.rows[0]?.id;
      if (!guestId) {
        sendJson(res, 500, { ok: false, error: 'Insert failed' });
        return;
      }
      // Surface the guest as a contact in the contacts board immediately
      await query(
        `INSERT INTO briefing_items (tenant_id, type, urgency_score, summary_text, contact_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING`,
        [auth.tenantId, 'open_house_lead',
         6,
         `Follow up with ${guestName.trim()} from open house`,
         guestId],
      );
      await query(
        `INSERT INTO contacts (id, tenant_id, name, phone, stage, source)
         VALUES ($1,$2,$3,$4,'Lead','Open House')
         ON CONFLICT (tenant_id, id) DO NOTHING`,
        [guestId, auth.tenantId, guestName.trim(), guestPhone ?? null],
      );

      sendJson(res, 201, { id: guestId });
      if (brainDumpText) {
        const knowledgeCorrelationId = uuidv4();
        const knowledgeMsg = normalizeInbound('mobile', {
          text: `knowledge update for open house guest ${guestName.trim()}: ${brainDumpText}`,
          channelId: 'kiosk',
          userId: auth.tenantId,
          username: 'agent',
          correlationId: knowledgeCorrelationId,
        });
        setImmediate(async () => {
          try {
            const coordinator = await tenantRegistry.getOrCreate(auth.tenantId);
            await coordinator.handleInbound(knowledgeMsg);
          } catch (err) {
            log.error(`[Kiosk] Knowledge update error for ${auth.tenantId}`, { error: (err as Error).message });
          }
        });
      }
      return;
    }

    // ─── POST /v1/open-house/conclude (JWT required) ──────────────────────────
    if (req.method === 'POST' && url.pathname === '/v1/open-house/conclude') {
      let auth: AuthContext;
      try {
        auth = requireAuth(req);
      } catch (err) {
        sendJson(res, 401, { ok: false, error: (err as Error).message });
        return;
      }
      if (!dbAvailable) {
        sendJson(res, 503, { ok: false, error: 'Database not available' });
        return;
      }
      const concludeGuests = await query<{
        name: string; phone: string | null; working_with_agent: boolean; brain_dump_text: string | null;
      }>(
        `SELECT name, phone, working_with_agent, brain_dump_text
         FROM open_house_guests WHERE tenant_id = $1 AND open_house_date = CURRENT_DATE
         ORDER BY created_at ASC`,
        [auth.tenantId],
      );
      const guestSummary = concludeGuests.rows
        .map(g => `${g.name}${g.phone ? ` (${g.phone})` : ''}${g.working_with_agent ? ' [has agent]' : ''}${g.brain_dump_text ? ` — notes: ${g.brain_dump_text}` : ''}`)
        .join('; ');
      const concludeCorrelationId = uuidv4();
      const concludeMsg = normalizeInbound('mobile', {
        text: `post event followup for today's open house. ${concludeGuests.rows.length} guest(s): ${guestSummary || 'no guests recorded'}. Draft personalized follow-up messages for each guest.`,
        channelId: 'kiosk',
        userId: auth.tenantId,
        username: 'agent',
        correlationId: concludeCorrelationId,
      });
      sendJson(res, 200, { ok: true, correlationId: concludeCorrelationId, guestCount: concludeGuests.rows.length });
      setImmediate(async () => {
        try {
          const coordinator = await tenantRegistry.getOrCreate(auth.tenantId);
          await coordinator.handleInbound(concludeMsg);
        } catch (err) {
          log.error(`[OpenHouse:conclude] Error for ${auth.tenantId}`, { error: (err as Error).message });
          wsSessionManager.push(auth.tenantId, {
            type: 'ERROR', correlationId: concludeCorrelationId, tenantId: auth.tenantId,
            timestamp: new Date().toISOString(),
            payload: { message: (err as Error).message },
          });
        }
      });
      return;
    }

    // ─── POST /v1/content/generate (JWT required, Professional) ──────────────
    if (req.method === 'POST' && url.pathname === '/v1/content/generate') {
      let auth: AuthContext;
      try {
        auth = requireAuth(req);
      } catch (err) {
        sendJson(res, 401, { ok: false, error: (err as Error).message });
        return;
      }
      if (!assertPlan(auth, 'professional', res)) return;
      let contentGenBody: string;
      try {
        contentGenBody = await readBodySafe(req, 20 * 1024 * 1024);
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode === 413 ? 413 : 400;
        sendJson(res, status, { ok: false, error: status === 413 ? 'Images too large (max 20MB total)' : 'Failed to read request body' });
        return;
      }
      const {
        targetMode: genTargetMode = 'content',
        assets: genAssets,
        textPrompt: genTextPrompt,
        platforms: genPlatforms = ['MLS', 'Instagram', 'Facebook'],
        // legacy compat
        preset: genPreset,
        images: genImages,
        keyFeatures: genFeatures,
        tone: genTone,
      } = JSON.parse(contentGenBody) as {
        targetMode?: string; assets?: string[]; textPrompt?: string; platforms?: string[];
        preset?: string; images?: string[]; keyFeatures?: string; tone?: string;
      };
      const resolvedImages = genAssets ?? genImages ?? [];
      const resolvedText = genTextPrompt ?? genFeatures ?? '';
      const genCorrelationId = uuidv4();
      const imageInfo = resolvedImages.length ? `${resolvedImages.length} image(s) provided` : 'no images';
      const taskLabel = genTargetMode === 'staging'
        ? 'Virtual staging request'
        : `Studio content generation for preset "${genPreset ?? 'new_listing'}"`;
      const baseGenMsg = normalizeInbound('mobile', {
        text: `${taskLabel}. ${imageInfo}. Tone: ${genTone ?? 'Standard'}. Features: ${resolvedText || 'not specified'}. Platforms: ${genPlatforms.join(', ')}. Run compliance check. Return structured JSON result.`,
        channelId: 'studio',
        userId: auth.tenantId,
        username: 'agent',
        correlationId: genCorrelationId,
      });
      const genMsg = {
        ...baseGenMsg,
        structuredData: {
          targetMode: genTargetMode,
          images: resolvedImages,
          textPrompt: resolvedText,
          platforms: genPlatforms,
          preset: genPreset ?? 'new_listing',
          tone: genTone ?? 'Standard',
          taskTypeHint: genTargetMode === 'staging' ? 'virtual_staging' : 'studio_generate',
          targetAgent: 'content',
        },
      };
      sendJson(res, 202, { ok: true, correlationId: genCorrelationId });
      setImmediate(async () => {
        try {
          const coordinator = await tenantRegistry.getOrCreate(auth.tenantId);
          await coordinator.handleInbound(genMsg);
        } catch (err) {
          log.error(`[Studio:generate] Error for ${auth.tenantId}`, { error: (err as Error).message });
          wsSessionManager.push(auth.tenantId, {
            type: 'ERROR', correlationId: genCorrelationId, tenantId: auth.tenantId,
            timestamp: new Date().toISOString(),
            payload: { message: (err as Error).message },
          });
        }
      });
      return;
    }

    // ─── POST /v1/content/regenerate (JWT required, Professional) ────────────
    if (req.method === 'POST' && url.pathname === '/v1/content/regenerate') {
      let auth: AuthContext;
      try {
        auth = requireAuth(req);
      } catch (err) {
        sendJson(res, 401, { ok: false, error: (err as Error).message });
        return;
      }
      if (!assertPlan(auth, 'professional', res)) return;
      let regenBody: string;
      try {
        regenBody = await readBodySafe(req);
      } catch {
        sendJson(res, 400, { ok: false, error: 'Failed to read request body' });
        return;
      }
      const { featureJson, tone: regenTone, preset: regenPreset, keyFeatures: regenFeatures } = JSON.parse(regenBody) as {
        featureJson?: object; tone?: string; preset?: string; keyFeatures?: string;
      };
      const regenCorrelationId = uuidv4();
      const regenMsg = {
        ...normalizeInbound('mobile', {
          text: `Regenerate studio content. Preset: "${regenPreset ?? 'new_listing'}". Tone: ${regenTone ?? 'Standard'}. Key features: ${regenFeatures ?? 'same as before'}.`,
          channelId: 'studio',
          userId: auth.tenantId,
          username: 'agent',
          correlationId: regenCorrelationId,
        }),
        structuredData: {
          targetMode: 'content',
          images: [],
          textPrompt: regenFeatures ?? '',
          platforms: ['MLS', 'Instagram', 'Facebook'],
          preset: regenPreset ?? 'new_listing',
          tone: regenTone ?? 'Standard',
          featureJson,
          taskTypeHint: 'studio_generate',
          targetAgent: 'content',
        },
      };
      sendJson(res, 202, { ok: true, correlationId: regenCorrelationId });
      setImmediate(async () => {
        try {
          const coordinator = await tenantRegistry.getOrCreate(auth.tenantId);
          await coordinator.handleInbound(regenMsg);
        } catch (err) {
          log.error(`[Studio:regenerate] Error for ${auth.tenantId}`, { error: (err as Error).message });
          wsSessionManager.push(auth.tenantId, {
            type: 'ERROR', correlationId: regenCorrelationId, tenantId: auth.tenantId,
            timestamp: new Date().toISOString(),
            payload: { message: (err as Error).message },
          });
        }
      });
      return;
    }

    // ─── Legacy: POST /message (no auth — uses default tenant) ───
    if (req.method === 'POST' && url.pathname === '/message') {
      try {
        const body = await readBodySafe(req);
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
        const body = await readBodySafe(req);
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

      // Require auth — mobile app passes JWT as ?token= for browser-redirect flows
      const tokenParam = url.searchParams.get('token');
      const connectAuth = extractTenant(tokenParam
        ? { headers: { authorization: `Bearer ${tokenParam}` } } as never
        : req,
      );
      if (!connectAuth) {
        sendJson(res, 401, { error: 'Authentication required to connect integrations' });
        return;
      }

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
      oauthStateStore.set(state, { integrationId, tenantId: connectAuth.tenantId, expiresAt: now + 10 * 60 * 1000 });

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

      const { tenantId: oauthTenantId } = stateEntry;
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
        // Store tokens namespaced by tenantId so each agent's Gmail is isolated
        await handler.storeTokens(integrationId as never, tokens, oauthTenantId);
        await setIntegrationEnabled(INTEGRATIONS_CONFIG, integrationId);

        // For Gmail: fetch the connected address and upsert tenant_gmail_auth
        if (integrationId === 'gmail' && dbAvailable) {
          try {
            const profileRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
              headers: { Authorization: `Bearer ${tokens.accessToken}` },
            });
            const profile = await profileRes.json() as { emailAddress?: string; historyId?: string };
            if (profile.emailAddress) {
              await query(
                `INSERT INTO tenant_gmail_auth (tenant_id, gmail_address, history_id)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (tenant_id) DO UPDATE
                   SET gmail_address = EXCLUDED.gmail_address,
                       history_id    = EXCLUDED.history_id,
                       revoked_at    = NULL`,
                [oauthTenantId, profile.emailAddress, profile.historyId ?? null],
              );
            }
          } catch (gmailErr) {
            log.warn('[OAuth] Could not fetch Gmail profile after connect', { error: (gmailErr as Error).message });
          }
        }

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<html><body><h1>Connected!</h1><p>${integrationId} is now connected. You may close this window.</p></body></html>`);
      } catch (err) {
        log.error(`OAuth callback failed for ${integrationId}`, { error: (err as Error).message });
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

    // ─── GET /v1/sms (JWT required) — conversation list ──────────────────────
    if (req.method === 'GET' && url.pathname === '/v1/sms') {
      let auth: AuthContext;
      try { auth = requireAuth(req); }
      catch (err) { sendJson(res, 401, { ok: false, error: (err as Error).message }); return; }
      if (!dbAvailable) { sendJson(res, 200, { conversations: [] }); return; }
      try {
        const rows = await query<{
          id: string; contact_id: string | null; body: string; direction: string;
          created_at: string; extracted_signals: Record<string, unknown> | null;
          name: string | null; phone: string | null; unread_count: string;
        }>(
          `SELECT DISTINCT ON (COALESCE(s.contact_id, s.from_number))
             s.id, s.contact_id, s.body, s.direction,
             s.created_at, s.extracted_signals,
             c.name, c.phone,
             COUNT(*) FILTER (WHERE s2.direction = 'inbound' AND s2.status = 'received')
               OVER (PARTITION BY COALESCE(s.contact_id, s.from_number)) AS unread_count
           FROM sms_messages s
           LEFT JOIN contacts c ON c.id = s.contact_id AND c.tenant_id = s.tenant_id
           LEFT JOIN sms_messages s2 ON s2.tenant_id = s.tenant_id
             AND COALESCE(s2.contact_id, s2.from_number) = COALESCE(s.contact_id, s.from_number)
           WHERE s.tenant_id = $1
           ORDER BY COALESCE(s.contact_id, s.from_number), s.created_at DESC`,
          [auth.tenantId],
        );
        sendJson(res, 200, {
          conversations: rows.rows.map(r => ({
            contactId: r.contact_id,
            contactName: r.name ?? null,
            phone: r.phone ?? null,
            lastMessage: r.body,
            lastMessageAt: r.created_at,
            lastDirection: r.direction,
            unreadCount: parseInt(r.unread_count ?? '0', 10),
            latestSignals: r.extracted_signals ?? null,
          })),
        });
      } catch (err) {
        log.error('[GET /v1/sms] query failed', { error: String(err) });
        sendJson(res, 500, { ok: false, error: 'Failed to fetch conversations' });
      }
      return;
    }

    // ─── GET /v1/sms/:contactId (JWT required) — thread ──────────────────────
    if (req.method === 'GET' && url.pathname.startsWith('/v1/sms/')) {
      let auth: AuthContext;
      try { auth = requireAuth(req); }
      catch (err) { sendJson(res, 401, { ok: false, error: (err as Error).message }); return; }
      const threadContactId = decodeURIComponent(url.pathname.slice('/v1/sms/'.length));
      if (!dbAvailable) { sendJson(res, 200, { messages: [] }); return; }
      try {
        const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);
        const before = url.searchParams.get('before');
        const params: (string | number)[] = [auth.tenantId, threadContactId, Math.min(limit, 100)];
        const beforeClause = before ? `AND s.created_at < $4` : '';
        if (before) params.push(before);
        const rows = await query<{
          id: string; direction: string; body: string; status: string; sent_via: string;
          extracted_signals: Record<string, unknown> | null; created_at: string; twilio_sid: string | null;
        }>(
          `SELECT id, direction, body, status, sent_via, extracted_signals, created_at, twilio_sid
           FROM sms_messages
           WHERE tenant_id = $1 AND contact_id = $2 ${beforeClause}
           ORDER BY created_at DESC
           LIMIT $3`,
          params,
        );
        // Mark inbound messages as read
        await query(
          `UPDATE sms_messages SET status = 'read'
           WHERE tenant_id = $1 AND contact_id = $2 AND direction = 'inbound' AND status = 'received'`,
          [auth.tenantId, threadContactId],
        );
        sendJson(res, 200, {
          messages: rows.rows.reverse().map(r => ({
            id: r.id,
            direction: r.direction,
            body: r.body,
            status: r.status,
            sentVia: r.sent_via,
            extractedSignals: r.extracted_signals ?? null,
            createdAt: r.created_at,
            twilioSid: r.twilio_sid ?? null,
          })),
        });
      } catch (err) {
        log.error('[GET /v1/sms/:contactId] query failed', { error: String(err) });
        sendJson(res, 500, { ok: false, error: 'Failed to fetch thread' });
      }
      return;
    }

    // ─── POST /v1/sms (JWT required) — send SMS ───────────────────────────────
    if (req.method === 'POST' && url.pathname === '/v1/sms') {
      let auth: AuthContext;
      try { auth = requireAuth(req); }
      catch (err) { sendJson(res, 401, { ok: false, error: (err as Error).message }); return; }
      let smsBody: string;
      try { smsBody = await readBodySafe(req); }
      catch { sendJson(res, 400, { ok: false, error: 'Failed to read request body' }); return; }
      const { contactId: smsContactId, message: smsMessage, sentVia: smsSentVia = 'agent' } =
        JSON.parse(smsBody) as { contactId: string; message: string; sentVia?: string };
      if (!smsContactId || !smsMessage?.trim()) {
        sendJson(res, 400, { ok: false, error: 'contactId and message are required' });
        return;
      }
      if (!dbAvailable) { sendJson(res, 503, { ok: false, error: 'Database unavailable' }); return; }
      try {
        const contactRow = await query<{ phone: string | null; sms_opted_in: boolean; name: string | null }>(
          `SELECT phone, sms_opted_in, name FROM contacts WHERE tenant_id = $1 AND id = $2`,
          [auth.tenantId, smsContactId],
        );
        const contact = contactRow.rows[0];
        if (!contact) { sendJson(res, 404, { ok: false, error: 'Contact not found' }); return; }
        if (!contact.sms_opted_in) {
          sendJson(res, 403, { ok: false, error: 'Contact has not opted in to SMS' });
          return;
        }
        if (!contact.phone) {
          sendJson(res, 400, { ok: false, error: 'Contact has no phone number' });
          return;
        }
        await tenantRegistry.getOrCreate(auth.tenantId);
        const twilio = tenantRegistry.getIntegrationManager(auth.tenantId)
          ?.getIntegration<TwilioIntegration>(IntegrationId.TWILIO);
        let twilioSid: string | null = null;
        if (twilio) {
          const result = await twilio.sendSms(contact.phone, smsMessage.trim());
          twilioSid = result.messageSid;
        }
        const msgId = uuidv4();
        await query(
          `INSERT INTO sms_messages (id, tenant_id, contact_id, direction, body, from_number, to_number, twilio_sid, status, sent_via)
           VALUES ($1,$2,$3,'outbound',$4,$5,$6,$7,'sent',$8)`,
          [msgId, auth.tenantId, smsContactId, smsMessage.trim(),
           process.env.CLAW_TWILIO_PHONE_NUMBER ?? 'unknown', contact.phone,
           twilioSid, smsSentVia],
        );
        sendJson(res, 201, { ok: true, id: msgId, status: 'sent', twilioSid });
      } catch (err) {
        log.error('[POST /v1/sms] send failed', { error: String(err) });
        sendJson(res, 500, { ok: false, error: 'Failed to send SMS' });
      }
      return;
    }

    // ─── PATCH /v1/sms/:contactId/opt-in (JWT required) ──────────────────────
    if (req.method === 'PATCH' && url.pathname.match(/^\/v1\/sms\/[^/]+\/opt-in$/)) {
      let auth: AuthContext;
      try { auth = requireAuth(req); }
      catch (err) { sendJson(res, 401, { ok: false, error: (err as Error).message }); return; }
      const optInContactId = url.pathname.split('/')[3]!;
      if (!dbAvailable) { sendJson(res, 503, { ok: false, error: 'Database unavailable' }); return; }
      try {
        await query(
          `UPDATE contacts SET sms_opted_in = true, sms_opted_in_at = NOW()
           WHERE tenant_id = $1 AND id = $2`,
          [auth.tenantId, optInContactId],
        );
        sendJson(res, 200, { ok: true });
      } catch (err) {
        log.error('[PATCH /v1/sms/opt-in] failed', { error: String(err) });
        sendJson(res, 500, { ok: false, error: 'Failed to update opt-in status' });
      }
      return;
    }

    // ─── POST /webhooks/gmail — Google Pub/Sub push notification ──────────────
    if (req.method === 'POST' && url.pathname === '/webhooks/gmail') {
      let rawBody: string;
      try { rawBody = await readBodySafe(req); } catch { res.writeHead(400); res.end(); return; }
      await handleGmailWebhook(req, res, rawBody);
      return;
    }

    // ─── POST /webhooks/twilio/sms — inbound SMS from Twilio ─────────────────
    if (req.method === 'POST' && url.pathname === '/webhooks/twilio/sms') {
      let rawBody: string;
      try { rawBody = await readBodySafe(req); }
      catch { res.writeHead(400).end(); return; }
      // Parse Twilio application/x-www-form-urlencoded payload
      const params = new URLSearchParams(rawBody);
      const fromNumber = params.get('From') ?? '';
      const toNumber = params.get('To') ?? '';
      const body = params.get('Body') ?? '';
      const twilioSid = params.get('MessageSid') ?? '';
      if (!fromNumber || !twilioSid) { res.writeHead(400).end(); return; }
      // Respond immediately to Twilio with empty TwiML
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
      // Handle STOP — opt out contact
      if (/^stop$/i.test(body.trim())) {
        if (dbAvailable) {
          await query(
            `UPDATE contacts SET sms_opted_in = false
             WHERE phone = $1 AND tenant_id IN (
               SELECT tenant_id FROM contacts WHERE phone = $1 LIMIT 1
             )`,
            [fromNumber],
          ).catch(err => log.error('STOP opt-out failed', { error: String(err) }));
        }
        return;
      }
      // Process inbound async (response already sent)
      setImmediate(async () => {
        try {
          if (!dbAvailable) return;
          // Match sender to a known contact
          const contactMatch = await query<{ tenant_id: string; id: string; name: string | null }>(
            `SELECT tenant_id, id, name FROM contacts WHERE phone = $1 LIMIT 1`,
            [fromNumber],
          );
          const matched = contactMatch.rows[0];
          const tenantId = matched?.tenant_id ?? 'unknown';
          const contactId = matched?.id ?? null;
          const msgId = uuidv4();
          await query(
            `INSERT INTO sms_messages (id, tenant_id, contact_id, direction, body, from_number, to_number, twilio_sid, status, sent_via)
             VALUES ($1,$2,$3,'inbound',$4,$5,$6,$7,'received','contact')
             ON CONFLICT DO NOTHING`,
            [msgId, tenantId, contactId, body, fromNumber, toNumber, twilioSid],
          );
          // Push SMS_RECEIVED to tenant's WebSocket sessions
          wsSessionManager.push(tenantId, {
            type: 'SMS_RECEIVED',
            correlationId: msgId,
            tenantId,
            timestamp: new Date().toISOString(),
            payload: {
              messageId: msgId,
              contactId,
              contactName: matched?.name ?? null,
              fromNumber,
              body,
              createdAt: new Date().toISOString(),
            },
          });
          // Async signal extraction — route to RelationshipAgent via coordinator
          if (contactId && tenantId !== 'unknown') {
            const coordinator = await tenantRegistry.getOrCreate(tenantId).catch(() => null);
            if (coordinator) {
              coordinator.extractSmsSignals(msgId, contactId, body, wsSessionManager).catch(
                err => log.error('SMS signal extraction failed', { error: String(err) }),
              );
            }
          }
        } catch (err) {
          log.error('Inbound SMS processing failed', { error: String(err), twilioSid });
        }
      });
      return;
    }

    // ─── POST /webhooks/twilio/status — delivery status callback ─────────────
    if (req.method === 'POST' && url.pathname === '/webhooks/twilio/status') {
      let rawStatus: string;
      try { rawStatus = await readBodySafe(req); }
      catch { res.writeHead(400).end(); return; }
      res.writeHead(204).end();
      const statusParams = new URLSearchParams(rawStatus);
      const statusSid = statusParams.get('MessageSid') ?? '';
      const msgStatus = statusParams.get('MessageStatus') ?? '';
      if (!statusSid || !dbAvailable) return;
      setImmediate(async () => {
        try {
          const updated = await query<{ tenant_id: string; id: string }>(
            `UPDATE sms_messages SET status = $1 WHERE twilio_sid = $2 RETURNING tenant_id, id`,
            [msgStatus, statusSid],
          );
          const row = updated.rows[0];
          if (row) {
            wsSessionManager.push(row.tenant_id, {
              type: 'SMS_STATUS',
              correlationId: row.id,
              tenantId: row.tenant_id,
              timestamp: new Date().toISOString(),
              payload: { messageId: row.id, twilioSid: statusSid, status: msgStatus },
            });
          }
        } catch (err) {
          log.error('Delivery status update failed', { error: String(err), statusSid });
        }
      });
      return;
    }

    // ─── GET /v1/deals (JWT required) — list active deals ────────────────────
    if (req.method === 'GET' && url.pathname === '/v1/deals') {
      let auth: AuthContext;
      try { auth = requireAuth(req); }
      catch (err) { sendJson(res, 401, { ok: false, error: (err as Error).message }); return; }
      if (!dbAvailable) { sendJson(res, 200, { deals: [] }); return; }
      try {
        const { rows } = await query<Record<string, unknown>>(
          `SELECT d.id, d.address, d.deal_type, d.stage, d.status, d.purchase_price,
                  d.closing_date, d.buyer_name, d.seller_name, d.contact_id, d.created_at,
                  (SELECT json_agg(m ORDER BY m.sequence_order)
                   FROM deal_milestones m WHERE m.deal_id = d.id) AS milestones
           FROM deals d
           WHERE d.tenant_id = $1 AND d.status = 'active'
           ORDER BY d.closing_date ASC NULLS LAST`,
          [auth.tenantId],
        );
        sendJson(res, 200, { deals: rows });
      } catch (err) {
        log.error('[GET /v1/deals] query failed', { error: String(err) });
        sendJson(res, 500, { ok: false, error: 'Failed to fetch deals' });
      }
      return;
    }

    // ─── GET /v1/deals/alerts (JWT required) — P0/P1 alerts ──────────────────
    if (req.method === 'GET' && url.pathname === '/v1/deals/alerts') {
      let auth: AuthContext;
      try { auth = requireAuth(req); }
      catch (err) { sendJson(res, 401, { ok: false, error: (err as Error).message }); return; }
      if (!dbAvailable) { sendJson(res, 200, { alerts: [] }); return; }
      try {
        const { rows } = await query<Record<string, unknown>>(
          `SELECT a.id, a.deal_id, a.priority, a.message, a.action_type, a.action_label,
                  a.action_payload, a.created_at, d.address
           FROM deal_alerts a
           JOIN deals d ON d.id = a.deal_id
           WHERE d.tenant_id = $1 AND a.dismissed_at IS NULL
           ORDER BY a.priority ASC, a.created_at DESC`,
          [auth.tenantId],
        );
        sendJson(res, 200, { alerts: rows });
      } catch (err) {
        log.error('[GET /v1/deals/alerts] query failed', { error: String(err) });
        sendJson(res, 500, { ok: false, error: 'Failed to fetch alerts' });
      }
      return;
    }

    // ─── GET /v1/deals/:id (JWT required) — deal detail ──────────────────────
    if (req.method === 'GET' && url.pathname.startsWith('/v1/deals/') && !url.pathname.includes('/milestones/') && !url.pathname.includes('/alerts/') && !url.pathname.includes('/documents/')) {
      let auth: AuthContext;
      try { auth = requireAuth(req); }
      catch (err) { sendJson(res, 401, { ok: false, error: (err as Error).message }); return; }
      const dealId = decodeURIComponent(url.pathname.slice('/v1/deals/'.length));
      if (!dbAvailable) { sendJson(res, 503, { ok: false, error: 'Database unavailable' }); return; }
      try {
        const dealResult = await query<Record<string, unknown>>(
          'SELECT * FROM deals WHERE id = $1 AND tenant_id = $2',
          [dealId, auth.tenantId],
        );
        if (!dealResult.rows[0]) { sendJson(res, 404, { ok: false, error: 'Deal not found' }); return; }
        const [milestones, documents, alerts] = await Promise.all([
          query<Record<string, unknown>>('SELECT * FROM deal_milestones WHERE deal_id = $1 ORDER BY sequence_order', [dealId]),
          query<Record<string, unknown>>('SELECT * FROM deal_documents WHERE deal_id = $1 ORDER BY is_blocking DESC', [dealId]),
          query<Record<string, unknown>>('SELECT * FROM deal_alerts WHERE deal_id = $1 AND dismissed_at IS NULL ORDER BY priority, created_at DESC', [dealId]),
        ]);
        sendJson(res, 200, {
          deal: dealResult.rows[0],
          milestones: milestones.rows,
          documents: documents.rows,
          alerts: alerts.rows,
        });
      } catch (err) {
        log.error('[GET /v1/deals/:id] query failed', { error: String(err) });
        sendJson(res, 500, { ok: false, error: 'Failed to fetch deal' });
      }
      return;
    }

    // ─── POST /v1/deals/ingest (JWT required, Professional) — parse contract → create deal ─
    if (req.method === 'POST' && url.pathname === '/v1/deals/ingest') {
      let auth: AuthContext;
      try { auth = requireAuth(req); }
      catch (err) { sendJson(res, 401, { ok: false, error: (err as Error).message }); return; }
      if (!assertPlan(auth, 'professional', res)) return;
      let body: string;
      try { body = await readBodySafe(req); }
      catch { sendJson(res, 400, { ok: false, error: 'Failed to read request body' }); return; }
      const { contractText } = JSON.parse(body) as { contractText?: string };
      if (!contractText?.trim()) {
        sendJson(res, 400, { ok: false, error: 'contractText required' });
        return;
      }
      const correlationId = uuidv4();
      const ingestMsg = normalizeInbound('mobile', {
        text: contractText.trim(),
        channelId: 'deals',
        userId: auth.tenantId,
        username: 'agent',
        correlationId,
        structuredData: { taskType: 'deal_ingest', contractText: contractText.trim() },
      });
      sendJson(res, 202, { ok: true, correlationId });
      setImmediate(async () => {
        try {
          const coordinator = await tenantRegistry.getOrCreate(auth.tenantId);
          await coordinator.handleInbound(ingestMsg);
        } catch (err) {
          log.error('[POST /v1/deals/ingest] dispatch failed', { error: String(err) });
        }
      });
      return;
    }

    // ─── POST /v1/deals/:id/milestones/:milestoneId/complete ─────────────────
    if (req.method === 'POST' && url.pathname.match(/^\/v1\/deals\/[^/]+\/milestones\/[^/]+\/complete$/)) {
      let auth: AuthContext;
      try { auth = requireAuth(req); }
      catch (err) { sendJson(res, 401, { ok: false, error: (err as Error).message }); return; }
      const parts = url.pathname.split('/');
      const dealId = parts[3]!;
      const milestoneId = parts[5]!;
      if (!dbAvailable) { sendJson(res, 503, { ok: false, error: 'Database unavailable' }); return; }
      try {
        const ownership = await query('SELECT id FROM deals WHERE id = $1 AND tenant_id = $2', [dealId, auth.tenantId]);
        if (!ownership.rows[0]) { sendJson(res, 404, { ok: false, error: 'Deal not found' }); return; }
        await query(
          `UPDATE deal_milestones SET status = 'complete', completed_at = NOW()
           WHERE id = $1 AND deal_id = $2`,
          [milestoneId, dealId],
        );
        sendJson(res, 200, { ok: true });
      } catch (err) {
        log.error('[POST /v1/deals/:id/milestones/:id/complete] failed', { error: String(err) });
        sendJson(res, 500, { ok: false, error: 'Failed to complete milestone' });
      }
      return;
    }

    // ─── POST /v1/deals/:id/milestones/:milestoneId/waive ────────────────────
    if (req.method === 'POST' && url.pathname.match(/^\/v1\/deals\/[^/]+\/milestones\/[^/]+\/waive$/)) {
      let auth: AuthContext;
      try { auth = requireAuth(req); }
      catch (err) { sendJson(res, 401, { ok: false, error: (err as Error).message }); return; }
      const parts = url.pathname.split('/');
      const dealId = parts[3]!;
      const milestoneId = parts[5]!;
      if (!dbAvailable) { sendJson(res, 503, { ok: false, error: 'Database unavailable' }); return; }
      try {
        const ownership = await query('SELECT id FROM deals WHERE id = $1 AND tenant_id = $2', [dealId, auth.tenantId]);
        if (!ownership.rows[0]) { sendJson(res, 404, { ok: false, error: 'Deal not found' }); return; }
        await query(
          `UPDATE deal_milestones SET status = 'waived', waived_at = NOW()
           WHERE id = $1 AND deal_id = $2`,
          [milestoneId, dealId],
        );
        sendJson(res, 200, { ok: true });
      } catch (err) {
        log.error('[POST /v1/deals/:id/milestones/:id/waive] failed', { error: String(err) });
        sendJson(res, 500, { ok: false, error: 'Failed to waive milestone' });
      }
      return;
    }

    // ─── POST /v1/deals/:id/alerts/:alertId/dismiss ───────────────────────────
    if (req.method === 'POST' && url.pathname.match(/^\/v1\/deals\/[^/]+\/alerts\/[^/]+\/dismiss$/)) {
      let auth: AuthContext;
      try { auth = requireAuth(req); }
      catch (err) { sendJson(res, 401, { ok: false, error: (err as Error).message }); return; }
      const parts = url.pathname.split('/');
      const dealId = parts[3]!;
      const alertId = parts[5]!;
      if (!dbAvailable) { sendJson(res, 503, { ok: false, error: 'Database unavailable' }); return; }
      try {
        const ownership = await query('SELECT id FROM deals WHERE id = $1 AND tenant_id = $2', [dealId, auth.tenantId]);
        if (!ownership.rows[0]) { sendJson(res, 404, { ok: false, error: 'Deal not found' }); return; }
        await query(
          'UPDATE deal_alerts SET dismissed_at = NOW() WHERE id = $1 AND deal_id = $2',
          [alertId, dealId],
        );
        sendJson(res, 200, { ok: true });
      } catch (err) {
        log.error('[POST /v1/deals/:id/alerts/:id/dismiss] failed', { error: String(err) });
        sendJson(res, 500, { ok: false, error: 'Failed to dismiss alert' });
      }
      return;
    }

    // ─── PATCH /v1/deals/:id/documents/:docId ────────────────────────────────
    if (req.method === 'PATCH' && url.pathname.match(/^\/v1\/deals\/[^/]+\/documents\/[^/]+$/)) {
      let auth: AuthContext;
      try { auth = requireAuth(req); }
      catch (err) { sendJson(res, 401, { ok: false, error: (err as Error).message }); return; }
      let body: string;
      try { body = await readBodySafe(req); }
      catch { sendJson(res, 400, { ok: false, error: 'Failed to read request body' }); return; }
      const parts = url.pathname.split('/');
      const dealId = parts[3]!;
      const docId = parts[5]!;
      const { status: docStatus } = JSON.parse(body) as { status?: string };
      const VALID_DOC_STATUSES = ['required', 'uploaded', 'signed', 'waived', 'n_a'];
      if (!docStatus || !VALID_DOC_STATUSES.includes(docStatus)) {
        sendJson(res, 400, { ok: false, error: `status must be one of: ${VALID_DOC_STATUSES.join(', ')}` });
        return;
      }
      if (!dbAvailable) { sendJson(res, 503, { ok: false, error: 'Database unavailable' }); return; }
      try {
        const ownership = await query('SELECT id FROM deals WHERE id = $1 AND tenant_id = $2', [dealId, auth.tenantId]);
        if (!ownership.rows[0]) { sendJson(res, 404, { ok: false, error: 'Deal not found' }); return; }
        await query(
          'UPDATE deal_documents SET status = $1 WHERE id = $2 AND deal_id = $3',
          [docStatus, docId, dealId],
        );
        sendJson(res, 200, { ok: true });
      } catch (err) {
        log.error('[PATCH /v1/deals/:id/documents/:id] failed', { error: String(err) });
        sendJson(res, 500, { ok: false, error: 'Failed to update document' });
      }
      return;
    }

    // ─── POST /v1/webhooks/revenuecat — subscription lifecycle events ─────────
    if (req.method === 'POST' && url.pathname === '/v1/webhooks/revenuecat') {
      let webhookBody: string;
      try { webhookBody = await readBodySafe(req); }
      catch { sendJson(res, 400, { error: 'Failed to read body' }); return; }
      await handleRevenueCatWebhook(req, res, webhookBody);
      return;
    }

    // ─── GET /v1/subscription (JWT required) — current plan info ─────────────
    if (req.method === 'GET' && url.pathname === '/v1/subscription') {
      let auth: AuthContext;
      try { auth = requireAuth(req); }
      catch (err) { sendJson(res, 401, { error: (err as Error).message }); return; }
      if (!dbAvailable) { sendJson(res, 503, { error: 'Database unavailable' }); return; }
      try {
        const result = await query<{
          subscription_tier: string;
          subscription_status: string;
          subscription_expires_at: string | null;
          trial_started_at: string | null;
        }>(
          `SELECT subscription_tier, subscription_status, subscription_expires_at, trial_started_at
           FROM tenants WHERE tenant_id = $1`,
          [auth.tenantId],
        );
        const row = result.rows[0];
        if (!row) { sendJson(res, 404, { error: 'Tenant not found' }); return; }
        const trialEndsAt = row.trial_started_at
          ? new Date(new Date(row.trial_started_at).getTime() + 14 * 86_400_000).toISOString()
          : null;
        sendJson(res, 200, {
          tier: row.subscription_tier,
          status: row.subscription_status,
          expiresAt: row.subscription_expires_at,
          trialEndsAt,
          isTrialing: row.subscription_status === 'trialing',
        });
      } catch (err) {
        log.error('[GET /v1/subscription] query failed', { error: String(err) });
        sendJson(res, 500, { error: 'Failed to fetch subscription' });
      }
      return;
    }

    // ─── POST /v1/dev/subscription/override (non-production only) ────────────
    if (req.method === 'POST' && url.pathname === '/v1/dev/subscription/override') {
      if (process.env.NODE_ENV === 'production') {
        sendJson(res, 404, { error: 'Not found' });
        return;
      }
      let auth: AuthContext;
      try { auth = requireAuth(req); }
      catch (err) { sendJson(res, 401, { error: (err as Error).message }); return; }
      if (!dbAvailable) { sendJson(res, 503, { error: 'Database unavailable' }); return; }
      let overrideBody: string;
      try { overrideBody = await readBodySafe(req); }
      catch { sendJson(res, 400, { error: 'Failed to read body' }); return; }
      const { tier, status } = JSON.parse(overrideBody) as {
        tier?: string; status?: string;
      };
      const validTiers = ['starter', 'professional', 'brokerage'];
      const validStatuses = ['trialing', 'active', 'past_due', 'cancelled', 'paused'];
      if (!tier || !validTiers.includes(tier)) {
        sendJson(res, 400, { error: `tier must be one of: ${validTiers.join(', ')}` }); return;
      }
      if (!status || !validStatuses.includes(status)) {
        sendJson(res, 400, { error: `status must be one of: ${validStatuses.join(', ')}` }); return;
      }
      try {
        await query(
          `UPDATE tenants SET subscription_tier = $1, subscription_status = $2 WHERE tenant_id = $3`,
          [tier, status, auth.tenantId],
        );
        // Issue a fresh JWT with the updated claims so the client can use it immediately
        const tokens = await issueTokenPair(auth.tenantId, auth.userId);
        log.info(`[DEV] Subscription override: tenant ${auth.tenantId} → ${tier}/${status}`);
        sendJson(res, 200, { ok: true, ...tokens });
      } catch (err) {
        log.error('[POST /v1/dev/subscription/override] failed', { error: String(err) });
        sendJson(res, 500, { error: 'Failed to override subscription' });
      }
      return;
    }

    // ─── POST /dev/gmail/inject (non-production only) — simulate inbound email ─
    if (req.method === 'POST' && url.pathname === '/dev/gmail/inject') {
      if (process.env.NODE_ENV === 'production') {
        sendJson(res, 404, { error: 'Not found' }); return;
      }
      let body: string;
      try { body = await readBodySafe(req); } catch { sendJson(res, 400, { error: 'Bad request' }); return; }
      const payload = JSON.parse(body) as { tenantId?: string; from?: string; subject?: string; body?: string };
      if (!payload.tenantId || !payload.from) {
        sendJson(res, 400, { error: 'tenantId and from are required' }); return;
      }
      // Enqueue directly — bypasses tenant_gmail_auth DB lookup so no OAuth setup is needed locally
      const mockHistoryId = String(Date.now());
      sendJson(res, 202, { ok: true, mockHistoryId });
      setImmediate(async () => {
        try {
          const queue = getGmailIngestQueue();
          if (!queue) { log.warn('[DEV gmail inject] Ingest queue not initialised (Redis unavailable?)'); return; }
          await queue.add('gmail-ingest', {
            tenantId: payload.tenantId,
            emailAddress: payload.from ?? '',
            newHistoryId: mockHistoryId,
          }, { attempts: 3 });
          log.info('[DEV gmail inject] Job enqueued', { tenantId: payload.tenantId, mockHistoryId });
        } catch (err) {
          log.error('[DEV gmail inject] Error', { error: (err as Error).message });
        }
      });
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

    // Primary: Sec-WebSocket-Protocol: bearer.<token>  (avoids URL logging)
    // Fallback: ?token= query param (dev tooling — wscat, etc.)
    let authToken: string | undefined;
    const protocol = req.headers['sec-websocket-protocol'];
    if (protocol) {
      const bearerProto = protocol.split(',').map(s => s.trim()).find(p => p.startsWith('bearer.'));
      if (bearerProto) authToken = bearerProto.slice('bearer.'.length);
    }
    if (!authToken) authToken = upgradeUrl.searchParams.get('token') ?? undefined;

    let auth: AuthContext;
    try {
      auth = requireAuth({
        headers: { authorization: authToken ? `Bearer ${authToken}` : '' },
      } as http.IncomingMessage);
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
            log.info(`[WS:${auth.tenantId}] SUBSCRIBE to ${msg.correlationIds.length} correlationId(s)`);
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

      log.info(`[WS] Client connected — tenant: ${auth.tenantId}, sessions: ${wsSessionManager.getSessionCount(auth.tenantId)}`);
    });
  });

  server.listen(PORT, () => {
    log.info(`Claw gateway listening on port ${PORT}`);
    log.info('Ready. Endpoints:');
    log.info(`  GET  http://localhost:${PORT}/health`);
    log.info(`  POST http://localhost:${PORT}/v1/auth/apple`);
    log.info(`  POST http://localhost:${PORT}/v1/auth/google`);
    log.info(`  POST http://localhost:${PORT}/v1/auth/refresh`);
    log.info(`  POST http://localhost:${PORT}/v1/auth/revoke   (JWT required)`);
    log.info(`  POST http://localhost:${PORT}/v1/messages  (JWT required)`);
    log.info(`  POST http://localhost:${PORT}/v1/approvals/:id  (JWT required)`);
    log.info(`  GET  http://localhost:${PORT}/v1/tenants/me  (JWT required)`);
    log.info(`  GET  http://localhost:${PORT}/v1/integrations  (JWT required)`);
    log.info(`  POST http://localhost:${PORT}/v1/devices  (JWT required — push token registration)`);
    log.info(`  WSS  ws://localhost:${PORT}/ws  (Sec-WebSocket-Protocol: bearer.<token>)`);
    log.info(`  POST http://localhost:${PORT}/message  (legacy, default tenant)`);
    log.info(`  POST http://localhost:${PORT}/approval  (legacy, default tenant)`);
  });

  // ─── Graceful Shutdown ───
  const SHUTDOWN_DRAIN_MS = 30_000;

  const shutdown = async (signal: string): Promise<void> => {
    log.info(`${signal} received — shutting down gracefully...`);
    // 1. Stop BullMQ workers (no new jobs start) + node-cron schedulers
    await tenantRegistry.stopAll().catch(() => {});
    // 2. Stop accepting new WS connections
    wss.close();
    // 3. Drain in-flight HTTP with 30s timeout — prevents hanging shutdown
    await new Promise<void>(resolve => {
      const drainTimer = setTimeout(() => {
        log.warn('[Shutdown] Drain timeout exceeded — forcing close');
        resolve();
      }, SHUTDOWN_DRAIN_MS);
      server.close(() => {
        clearTimeout(drainTimer);
        resolve();
      });
    });
    // 4. Close BullMQ jobs + Redis connections
    if (briefingJobCleanup) {
      await briefingJobCleanup().catch(() => {});
    }
    if (dealJobCleanup) {
      await dealJobCleanup().catch(() => {});
    }
    if (gmailIngestCleanup) {
      await gmailIngestCleanup().catch(() => {});
    }
    if (gmailWatchCleanup) {
      await gmailWatchCleanup().catch(() => {});
    }
    if (toneAnalysisCleanup) {
      await toneAnalysisCleanup().catch(() => {});
    }
    if (redisClient) {
      await redisClient.quit().catch(() => {});
    }
    // 5. Close PG pool
    await closePool().catch(() => {});
    log.info('Gateway closed.');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  process.on('uncaughtException', err => {
    log.error('Uncaught exception', { error: (err as Error).message, stack: (err as Error).stack });
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
      return ['https://www.googleapis.com/auth/gmail.modify'];
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
  log.error('Fatal startup error', { error: (err as Error).message, stack: (err as Error).stack });
  process.exit(1);
});
