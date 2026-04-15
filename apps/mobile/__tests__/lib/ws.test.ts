/**
 * Tests for lib/ws.ts WebSocket client.
 *
 * Strategy: Mock the global WebSocket constructor so we can imperatively
 * fire onopen/onmessage/onclose events and verify store state + behavior.
 */

import { useAuthStore } from '../../store/auth';
import { useWsStore } from '../../store/ws';
import { useChatStore, type ChatMessage } from '../../store/chat';

// ─── Mock global WebSocket ───
class MockWebSocket {
  static instances: MockWebSocket[] = [];

  readonly url: string;
  readonly protocols: string | string[];
  readyState = 0; // CONNECTING

  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    this.protocols = protocols ?? [];
    MockWebSocket.instances.push(this);
  }

  close = jest.fn();
  send = jest.fn();

  // Test helpers to trigger lifecycle events
  simulateOpen(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  simulateMessage(data: object): void {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
  simulateClose(): void {
    this.readyState = 3;
    this.onclose?.();
  }
  simulateError(): void {
    this.onerror?.();
  }
}

beforeEach(() => {
  MockWebSocket.instances = [];
  (global as unknown as { WebSocket: typeof MockWebSocket }).WebSocket = MockWebSocket as unknown as typeof WebSocket;

  // Reset stores
  useAuthStore.setState({
    status: 'authenticated',
    accessToken: 'test-access-token',
    refreshToken: 'test-refresh',
    userId: 'u1',
    tenantId: 't1',
    expiresAt: Date.now() + 900_000,
  });
  useWsStore.setState({ status: 'disconnected', socket: null, pendingCorrelationIds: new Set() });
  useChatStore.setState({ messages: [] });
});

afterEach(() => {
  jest.clearAllTimers();
  // Disconnect cleanly to cancel any pending reconnect timers
  const { disconnect } = require('../../lib/ws');
  disconnect();
});

describe('connect()', () => {
  it('creates a WebSocket with bearer protocol header', () => {
    const { connect } = require('../../lib/ws');
    connect();
    expect(MockWebSocket.instances).toHaveLength(1);
    const protocols = MockWebSocket.instances[0].protocols;
    expect(protocols).toContain('bearer.test-access-token');
  });

  it('does nothing when no access token is available', () => {
    useAuthStore.setState({ status: 'unauthenticated', accessToken: null, refreshToken: null, userId: null, tenantId: null, expiresAt: null });
    const { connect } = require('../../lib/ws');
    connect();
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it('sets WS status to connecting immediately, then connected on open', () => {
    const { connect } = require('../../lib/ws');
    connect();
    expect(useWsStore.getState().status).toBe('connecting');

    MockWebSocket.instances[0].simulateOpen();
    expect(useWsStore.getState().status).toBe('connected');
  });

  it('sets status to error on socket error', () => {
    const { connect } = require('../../lib/ws');
    connect();
    MockWebSocket.instances[0].simulateError();
    expect(useWsStore.getState().status).toBe('error');
  });

  it('sets status to disconnected on socket close', () => {
    const { connect } = require('../../lib/ws');
    connect();
    MockWebSocket.instances[0].simulateOpen();
    // Switch to unauthenticated to prevent reconnect timer
    useAuthStore.setState({ status: 'unauthenticated', accessToken: null, refreshToken: null, userId: null, tenantId: null, expiresAt: null });
    MockWebSocket.instances[0].simulateClose();
    expect(useWsStore.getState().status).toBe('disconnected');
  });
});

describe('disconnect()', () => {
  it('closes the socket and sets status to disconnected', () => {
    const { connect, disconnect } = require('../../lib/ws');
    connect();
    MockWebSocket.instances[0].simulateOpen();
    disconnect();
    expect(MockWebSocket.instances[0].close).toHaveBeenCalled();
    expect(useWsStore.getState().status).toBe('disconnected');
  });
});

describe('message handling — AGENT_TYPING', () => {
  it('sets message status to streaming', () => {
    useChatStore.setState({
      messages: [{
        id: 'm1', correlationId: 'c1', role: 'assistant',
        text: '', status: 'sending', timestamp: new Date().toISOString(),
      } as ChatMessage],
    });

    const { connect } = require('../../lib/ws');
    connect();
    MockWebSocket.instances[0].simulateOpen();
    MockWebSocket.instances[0].simulateMessage({
      type: 'AGENT_TYPING',
      correlationId: 'c1',
      timestamp: new Date().toISOString(),
      payload: { intent: 'research', targets: ['research'] },
    });

    const msg = useChatStore.getState().messages[0];
    expect(msg.status).toBe('streaming');
  });
});

describe('message handling — TOKEN_STREAM', () => {
  it('accumulates tokens in the stream buffer (does not flush immediately)', () => {
    useChatStore.setState({
      messages: [{
        id: 'm1', correlationId: 'c1', role: 'assistant',
        text: '', status: 'streaming', timestamp: new Date().toISOString(),
      } as ChatMessage],
    });

    const { connect } = require('../../lib/ws');
    connect();
    MockWebSocket.instances[0].simulateOpen();

    MockWebSocket.instances[0].simulateMessage({
      type: 'TOKEN_STREAM',
      correlationId: 'c1',
      timestamp: new Date().toISOString(),
      payload: { token: 'Hello', sequenceIndex: 0 },
    });
    MockWebSocket.instances[0].simulateMessage({
      type: 'TOKEN_STREAM',
      correlationId: 'c1',
      timestamp: new Date().toISOString(),
      payload: { token: ' world', sequenceIndex: 1 },
    });

    // Tokens are buffered — message text unchanged until flush interval fires
    const msg = useChatStore.getState().messages[0];
    expect(msg.text).toBe('');
  });
});

describe('message handling — TASK_COMPLETE', () => {
  it('flushes buffered tokens to message and sets status done', () => {
    useChatStore.setState({
      messages: [{
        id: 'm1', correlationId: 'c1', role: 'assistant',
        text: '', status: 'streaming', timestamp: new Date().toISOString(),
      } as ChatMessage],
    });
    useWsStore.getState().addPending('c1');

    const { connect } = require('../../lib/ws');
    connect();
    MockWebSocket.instances[0].simulateOpen();

    // Buffer some tokens
    MockWebSocket.instances[0].simulateMessage({
      type: 'TOKEN_STREAM', correlationId: 'c1', timestamp: '',
      payload: { token: 'Buffered text', sequenceIndex: 0 },
    });

    // TASK_COMPLETE flushes buffered tokens
    MockWebSocket.instances[0].simulateMessage({
      type: 'TASK_COMPLETE', correlationId: 'c1', timestamp: '',
      payload: { text: 'Ignored because buffer wins', hasApproval: false },
    });

    const msg = useChatStore.getState().messages[0];
    expect(msg.text).toBe('Buffered text');
    expect(msg.status).toBe('done');
    expect(useWsStore.getState().pendingCorrelationIds.has('c1')).toBe(false);
  });

  it('uses payload text when no tokens were buffered', () => {
    useChatStore.setState({
      messages: [{
        id: 'm1', correlationId: 'c1', role: 'assistant',
        text: 'partial', status: 'streaming', timestamp: new Date().toISOString(),
      } as ChatMessage],
    });
    useWsStore.getState().addPending('c1');

    const { connect } = require('../../lib/ws');
    connect();
    MockWebSocket.instances[0].simulateOpen();

    MockWebSocket.instances[0].simulateMessage({
      type: 'TASK_COMPLETE', correlationId: 'c1', timestamp: '',
      payload: { text: 'Final answer', hasApproval: false },
    });

    const msg = useChatStore.getState().messages[0];
    expect(msg.text).toBe('Final answer');
    expect(msg.status).toBe('done');
  });
});

describe('message handling — ERROR', () => {
  it('sets message status to error and removes from pending', () => {
    useChatStore.setState({
      messages: [{
        id: 'm1', correlationId: 'c1', role: 'assistant',
        text: '', status: 'streaming', timestamp: new Date().toISOString(),
      } as ChatMessage],
    });
    useWsStore.getState().addPending('c1');

    const { connect } = require('../../lib/ws');
    connect();
    MockWebSocket.instances[0].simulateOpen();

    MockWebSocket.instances[0].simulateMessage({
      type: 'ERROR', correlationId: 'c1', timestamp: '',
      payload: { message: 'LLM quota exceeded' },
    });

    const msg = useChatStore.getState().messages[0];
    expect(msg.status).toBe('error');
    expect(msg.text).toContain('LLM quota exceeded');
    expect(useWsStore.getState().pendingCorrelationIds.has('c1')).toBe(false);
  });
});
