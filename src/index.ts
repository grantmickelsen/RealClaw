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

import { createLlmRouter } from './llm/factory.js';
import { MemoryManager } from './memory/memory-manager.js';
import { CredentialVault } from './credentials/vault.js';
import { RateLimiter } from './middleware/rate-limiter.js';
import { EventBus } from './agents/ops/event-bus.js';
import { AuditLogger } from './middleware/audit-logger.js';
import { HeartbeatScheduler } from './agents/ops/heartbeat.js';
import { Coordinator } from './coordinator/coordinator.js';
import { IntegrationManager } from './integrations/integration-manager.js';
import { bootstrapCredentialsFromEnv } from './setup/credential-bootstrap.js';
import { OAuthHandler } from './credentials/oauth-handler.js';

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

async function bootstrap(): Promise<void> {
  log('info', 'Starting Claw gateway...');

  // ─── Core Services ───
  const memoryPath = process.env.CLAW_MEMORY_PATH ?? path.resolve(__dirname, '..', 'memory');
  const memory = new MemoryManager(memoryPath);
  const eventBus = new EventBus();
  const auditLogger = new AuditLogger(path.join(memoryPath, 'system'));

  // ─── Credentials + Integrations ───
  const vault = new CredentialVault();
  const rateLimiter = new RateLimiter();

  const bootstrapResult = await bootstrapCredentialsFromEnv(vault);
  log('info', `Credential bootstrap: seeded=[${bootstrapResult.seeded.join(',')}]`);
  for (const f of bootstrapResult.failed) {
    log('warn', `Bootstrap failed ${f.id}: ${f.error}`);
  }

  const integrationManager = await IntegrationManager.fromConfigFile(
    INTEGRATIONS_CONFIG, vault, rateLimiter, auditLogger,
  );

  log('info', 'Initializing LLM router...');
  const llmRouter = await createLlmRouter(MODELS_CONFIG);

  log('info', 'Running LLM health checks...');
  const health = await llmRouter.healthCheckAll();
  for (const [provider, ok] of Object.entries(health)) {
    log(ok ? 'info' : 'warn', `  Provider ${provider}: ${ok ? 'OK' : 'UNAVAILABLE'}`);
  }

  // ─── Agent Registry ───
  const agentRegistry = new Map<AgentId, import('./agents/base-agent.js').BaseAgent>();

  function makeAgent<T extends import('./agents/base-agent.js').BaseAgent>(
    Cls: new (...args: ConstructorParameters<typeof import('./agents/base-agent.js').BaseAgent>) => T,
    id: AgentId,
  ): T {
    const config = AGENT_CONFIGS[id];
    return new Cls(config, llmRouter, memory, eventBus, auditLogger);
  }

  const knowledgeBase = makeAgent(KnowledgeBaseAgent, AgentId.KNOWLEDGE_BASE);
  const compliance = makeAgent(ComplianceAgent, AgentId.COMPLIANCE);
  const relationship = makeAgent(RelationshipAgent, AgentId.RELATIONSHIP);
  const comms = makeAgent(CommsAgent, AgentId.COMMS);
  const calendar = makeAgent(CalendarAgent, AgentId.CALENDAR);
  const content = makeAgent(ContentAgent, AgentId.CONTENT);
  const research = makeAgent(ResearchAgent, AgentId.RESEARCH);
  const transaction = makeAgent(TransactionAgent, AgentId.TRANSACTION);
  const ops = makeAgent(OpsAgent, AgentId.OPS);
  const openHouse = makeAgent(OpenHouseAgent, AgentId.OPEN_HOUSE);

  agentRegistry.set(AgentId.KNOWLEDGE_BASE, knowledgeBase);
  agentRegistry.set(AgentId.COMPLIANCE, compliance);
  agentRegistry.set(AgentId.RELATIONSHIP, relationship);
  agentRegistry.set(AgentId.COMMS, comms);
  agentRegistry.set(AgentId.CALENDAR, calendar);
  agentRegistry.set(AgentId.CONTENT, content);
  agentRegistry.set(AgentId.RESEARCH, research);
  agentRegistry.set(AgentId.TRANSACTION, transaction);
  agentRegistry.set(AgentId.OPS, ops);
  agentRegistry.set(AgentId.OPEN_HOUSE, openHouse);

  // Wire up agent registry for cross-agent queries
  for (const agent of agentRegistry.values()) {
    agent.setAgentRegistry(agentRegistry);
  }

  // Wire integration manager into all agents
  for (const agent of agentRegistry.values()) {
    agent.setIntegrationManager(integrationManager);
  }

  // Initialize all agents
  log('info', 'Initializing agents...');
  await Promise.all([...agentRegistry.values()].map(a => a.init()));
  log('info', `  ${agentRegistry.size} agents ready`);

  // ─── Coordinator ───
  const coordinator = new Coordinator(llmRouter, auditLogger, eventBus);
  await coordinator.init(CONFIG_DIR);

  // In-memory response store — keyed by channelId, capped at 50 per channel
  const responseStore = new Map<string, { platform: string; payload: unknown; timestamp: string }[]>();

  coordinator.onSendMessage(async (platform, channelId, payload) => {
    log('info', `[Outbound] ${platform}/${channelId}: ${JSON.stringify(payload).slice(0, 200)}`);
    const history = responseStore.get(channelId) ?? [];
    history.push({ platform, payload, timestamp: new Date().toISOString() });
    if (history.length > 50) history.shift();
    responseStore.set(channelId, history);
  });

  // Register all agents with the coordinator dispatcher
  for (const agent of agentRegistry.values()) {
    coordinator.registerDispatcher(agent);
  }

  // ─── Heartbeat Scheduler ───
  const heartbeat = new HeartbeatScheduler();
  heartbeat.onTrigger(trigger => coordinator.handleHeartbeat(trigger));

  try {
    const raw = await fs.readFile(HEARTBEAT_CONFIG, 'utf-8');
    const hbConfig = JSON.parse(raw);
    heartbeat.load(hbConfig);
    log('info', `Heartbeat: ${heartbeat.listScheduled().length} schedules loaded`);
  } catch {
    log('warn', 'No heartbeat.json found — scheduled tasks disabled');
  }

  // ─── Gateway HTTP Server ───
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Health check
    if (req.method === 'GET' && url.pathname === '/health') {
      const [llmHealth, integrationStatuses] = await Promise.all([
        llmRouter.healthCheckAll(),
        integrationManager.getStatus(),
      ]);
      const status = {
        status: 'ok',
        agents: agentRegistry.size,
        llm: llmHealth,
        integrations: integrationStatuses,
        heartbeat: heartbeat.listScheduled(),
        timestamp: new Date().toISOString(),
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status));
      return;
    }

    // Inbound message endpoint
    if (req.method === 'POST' && url.pathname === '/message') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const raw = JSON.parse(body) as Record<string, unknown>;
          const platform = String(raw['platform'] ?? 'discord');
          const message = normalizeInbound(platform, raw);
          await coordinator.handleInbound(message);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, messageId: message.messageId }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: (err as Error).message }));
        }
      });
      return;
    }

    // Approval response endpoint
    if (req.method === 'POST' && url.pathname === '/approval') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const response = JSON.parse(body) as ApprovalResponse;
          await coordinator.handleApprovalResponse(response);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: (err as Error).message }));
        }
      });
      return;
    }

    // OAuth: initiate flow — GET /oauth/connect/:integration
    if (req.method === 'GET' && url.pathname.startsWith('/oauth/connect/')) {
      const integrationId = url.pathname.slice('/oauth/connect/'.length);
      const clientId = await vault.retrieve(integrationId as never, 'client_id')
        ?? process.env[`CLAW_${integrationId.toUpperCase()}_CLIENT_ID`]
        ?? null;
      const clientSecret = await vault.retrieve(integrationId as never, 'client_secret')
        ?? process.env[`CLAW_${integrationId.toUpperCase()}_CLIENT_SECRET`]
        ?? null;

      if (!clientId || !clientSecret) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `OAuth credentials for ${integrationId} not configured` }));
        return;
      }

      const config = (await import('./credentials/oauth-handler.js').then(m => m)).OAuthHandler;
      void config; // used below via OAuthHandler import at top

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

    // OAuth: callback — GET /oauth/:integration/callback
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

        // Mark integration as enabled in config
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

    // Response polling — GET /response/:channelId
    if (req.method === 'GET' && url.pathname.startsWith('/response/')) {
      const channelId = decodeURIComponent(url.pathname.slice('/response/'.length));
      const responses = responseStore.get(channelId) ?? [];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ channelId, count: responses.length, responses }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  server.listen(PORT, () => {
    log('info', `Claw gateway listening on port ${PORT}`);
    log('info', 'Ready. Endpoints:');
    log('info', `  GET  http://localhost:${PORT}/health`);
    log('info', `  POST http://localhost:${PORT}/message`);
    log('info', `  POST http://localhost:${PORT}/approval`);
  });

  // ─── Graceful Shutdown ───
  process.on('SIGTERM', () => {
    log('info', 'SIGTERM received — shutting down gracefully...');
    heartbeat.stop();
    server.close(() => {
      log('info', 'Gateway closed.');
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    log('info', 'SIGINT received — shutting down...');
    heartbeat.stop();
    server.close(() => process.exit(0));
  });

  process.on('uncaughtException', err => {
    log('error', 'Uncaught exception:', err);
    eventBus.emit({
      messageId: uuidv4(),
      timestamp: new Date().toISOString(),
      correlationId: uuidv4(),
      type: 'EVENT',
      eventType: 'system.error',
      emittedBy: AgentId.OPS,
      payload: { error: err.message, stack: err.stack },
    });
  });
}

// ─── OAuth Helpers ───

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
