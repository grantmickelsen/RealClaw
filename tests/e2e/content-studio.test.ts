/**
 * Content Studio — end-to-end workflow tests
 *
 * Tests the full path: coordinator.handleInbound() → routing → content agent
 * → WS TASK_COMPLETE with raw JSON payload.
 *
 * Catches: wrong agent routing (e.g. LLM misclassifying studio requests as
 * email), synthesis destroying the JSON, missing WS TASK_COMPLETE event.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { WorkflowTestHarness, makeTaskResult, makeInboundMessage } from '../helpers/workflow-harness.js';
import { AgentId } from '../../src/types/agents.js';
import type { WsEnvelope } from '../../src/types/ws.js';
import { LlmProviderId } from '../../src/llm/types.js';

let tmpDir = '';

const STUDIO_JSON = JSON.stringify({
  mlsDescription: '3BR/2BA in prime Santa Barbara location with ocean views',
  instagramCaption: '#JustListed ✨ Stunning 3-bed home in Santa Barbara',
  facebookPost: 'New listing alert! Beautiful 3-bedroom home now available.',
  complianceFlags: [],
  featureJson: { beds: 3, baths: 2, sqft: 1800 },
});

const STAGING_JSON = JSON.stringify({
  stagedImageUrl: 'https://cdn.example.com/staged/room-123.jpg',
});

describe('Content Studio — full coordinator pipeline', () => {
  let harness: WorkflowTestHarness;

  beforeEach(async () => {
    vi.clearAllMocks();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claw-studio-e2e-'));
    harness = new WorkflowTestHarness(tmpDir);
  });

  afterEach(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ─── Routing hint: bypasses LLM, routes to content ────────────────────────

  it('taskTypeHint routes to content agent and TASK_COMPLETE carries raw JSON', async () => {
    harness.registerMockAgent(AgentId.CONTENT, makeTaskResult(AgentId.CONTENT, STUDIO_JSON));

    const events = await harness.send(makeInboundMessage({
      structuredData: {
        taskTypeHint: 'studio_generate',
        targetAgent: 'content',
        preset: 'new_listing',
        tone: 'Standard',
        textPrompt: '3BR in Santa Barbara',
        platforms: ['MLS', 'Instagram'],
      },
    }));

    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete, 'TASK_COMPLETE event must be emitted').toBeDefined();

    const payload = (complete!.payload as { text: string });
    const parsed = JSON.parse(payload.text) as Record<string, unknown>;
    expect(parsed).toHaveProperty('mlsDescription');
    expect(parsed).toHaveProperty('instagramCaption');
    expect(parsed).toHaveProperty('complianceFlags');

    // LLM NOT called — hint bypasses classification AND synthesis is skipped
    expect(harness.mockLlm.complete).not.toHaveBeenCalled();
  });

  // ─── Synthesis bypass: raw JSON reaches client ─────────────────────────────

  it('studio_generate TASK_COMPLETE text is raw JSON, not synthesized natural language', async () => {
    harness.registerMockAgent(AgentId.CONTENT, makeTaskResult(AgentId.CONTENT, STUDIO_JSON));

    const events = await harness.send(makeInboundMessage({
      structuredData: { taskTypeHint: 'studio_generate', targetAgent: 'content' },
    }));

    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();

    const text = (complete!.payload as { text: string }).text;
    // Must be parseable JSON — synthesis would return natural language instead
    expect(() => JSON.parse(text)).not.toThrow();
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(typeof parsed).toBe('object');
    expect(parsed).not.toHaveProperty('choices'); // not an LLM API response
  });

  // ─── Event ordering: AGENT_TYPING before TASK_COMPLETE ─────────────────────

  it('AGENT_TYPING is emitted before TASK_COMPLETE', async () => {
    harness.registerMockAgent(AgentId.CONTENT, makeTaskResult(AgentId.CONTENT, STUDIO_JSON));

    const events = await harness.send(makeInboundMessage({
      structuredData: { taskTypeHint: 'studio_generate', targetAgent: 'content' },
    }));

    const typingIdx = events.findIndex(e => e.type === 'AGENT_TYPING');
    const completeIdx = events.findIndex(e => e.type === 'TASK_COMPLETE');

    expect(typingIdx, 'AGENT_TYPING must be present').toBeGreaterThanOrEqual(0);
    expect(completeIdx, 'TASK_COMPLETE must be present').toBeGreaterThanOrEqual(0);
    expect(typingIdx).toBeLessThan(completeIdx);
  });

  // ─── LLM classification falls back correctly ────────────────────────────────

  it('without hint, LLM classification is called and routes to content agent', async () => {
    harness.registerMockAgent(AgentId.CONTENT, makeTaskResult(AgentId.CONTENT, STUDIO_JSON));

    harness.mockLlm.complete.mockResolvedValueOnce({
      text: JSON.stringify({ intent: 'studio_generate', confidence: 0.92, dispatchMode: 'single', targets: ['content'] }),
      inputTokens: 50, outputTokens: 20, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 100, estimatedCostUsd: 0,
    });

    const events = await harness.send(makeInboundMessage({
      content: { text: 'Generate listing content for 123 Main St', media: [] },
    }));

    expect(harness.mockLlm.complete).toHaveBeenCalledOnce();
    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
  });

  // ─── Virtual staging ────────────────────────────────────────────────────────

  it('virtual_staging hint routes to content agent and TASK_COMPLETE carries stagedImageUrl JSON', async () => {
    harness.registerMockAgent(AgentId.CONTENT, makeTaskResult(AgentId.CONTENT, STAGING_JSON));

    const events = await harness.send(makeInboundMessage({
      structuredData: {
        taskTypeHint: 'virtual_staging',
        targetAgent: 'content',
        images: ['data:image/jpeg;base64,/9j/test'],
        textPrompt: 'Modern minimalist',
      },
    }));

    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();

    const text = (complete!.payload as { text: string }).text;
    const parsed = JSON.parse(text) as { stagedImageUrl: string };
    expect(parsed.stagedImageUrl).toBeTruthy();
    expect(harness.mockLlm.complete).not.toHaveBeenCalled();
  });

  // ─── Missing content agent: coordinator returns error ──────────────────────

  it('dispatching to unregistered agent causes coordinator to send error reply', async () => {
    // No mock agent registered — dispatcher will throw "Agent not registered"
    const events = await harness.send(makeInboundMessage({
      structuredData: { taskTypeHint: 'studio_generate', targetAgent: 'content' },
    }));

    // Coordinator catches the dispatch error and sends an error TASK_COMPLETE
    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
    const text = (complete!.payload as { text: string }).text;
    expect(text.toLowerCase()).toMatch(/error|encountered/);
  });

  // ─── Compliance flags in output ─────────────────────────────────────────────

  it('studio result with compliance flags is forwarded as-is (not blocked by coordinator)', async () => {
    const flaggedJson = JSON.stringify({
      mlsDescription: 'Walk to best schools',
      instagramCaption: 'Near top schools',
      complianceFlags: ['steering_language'],
      featureJson: {},
    });
    harness.registerMockAgent(AgentId.CONTENT, makeTaskResult(AgentId.CONTENT, flaggedJson));

    const events = await harness.send(makeInboundMessage({
      structuredData: { taskTypeHint: 'studio_generate', targetAgent: 'content' },
    }));

    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
    const parsed = JSON.parse((complete!.payload as { text: string }).text) as Record<string, unknown>;
    expect(parsed['complianceFlags']).toEqual(['steering_language']);
  });
});
