import { useAuthStore } from '../store/auth';
import { useWsStore } from '../store/ws';
import { useChatStore } from '../store/chat';
import { WS_URL } from '../constants/api';

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const RECONNECT_DELAY_MS = 3_000;

// ─── Streaming ref buffer — 80ms flush (Decision 5) ───
const streamBuffers = new Map<string, string>(); // correlationId → accumulated text
let flushInterval: ReturnType<typeof setInterval> | null = null;

function startFlushInterval(): void {
  if (flushInterval) return;
  flushInterval = setInterval(() => {
    for (const [correlationId, text] of streamBuffers.entries()) {
      if (text) {
        useChatStore.getState().updateMessage(correlationId, { text, status: 'streaming' });
        streamBuffers.set(correlationId, '');
      }
    }
  }, 80);
}

function stopFlushInterval(): void {
  if (flushInterval) {
    clearInterval(flushInterval);
    flushInterval = null;
  }
  streamBuffers.clear();
}

export function connect(): void {
  const { accessToken } = useAuthStore.getState();
  if (!accessToken) return;

  const { setStatus, setSocket } = useWsStore.getState();
  setStatus('connecting');

  // Use Sec-WebSocket-Protocol header for auth (Decision 2)
  socket = new WebSocket(WS_URL, [`bearer.${accessToken}`]);

  socket.onopen = () => {
    setStatus('connected');
    setSocket(socket);
    startFlushInterval();
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  socket.onmessage = (event) => {
    try {
      handleMessage(JSON.parse(event.data as string) as WsEvent);
    } catch {
      // ignore malformed messages
    }
  };

  socket.onerror = () => {
    setStatus('error');
  };

  socket.onclose = () => {
    setStatus('disconnected');
    setSocket(null);
    stopFlushInterval();
    socket = null;
    // Reconnect after delay if still authenticated
    if (useAuthStore.getState().status === 'authenticated') {
      reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
    }
  };
}

export function disconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  stopFlushInterval();
  socket?.close();
  socket = null;
  useWsStore.getState().setStatus('disconnected');
  useWsStore.getState().setSocket(null);
}

// ─── WS message shape ───

interface WsEvent {
  type: string;
  correlationId: string;
  tenantId?: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

function handleMessage(event: WsEvent): void {
  const { updateMessage, removePending } = useWsStore.getState() as { updateMessage?: unknown; removePending: (id: string) => void };
  void updateMessage;

  switch (event.type) {
    case 'CONNECTED':
      // Handshake confirmed — nothing extra needed
      break;

    case 'AGENT_TYPING':
      useChatStore.getState().updateMessage(event.correlationId, { status: 'streaming' });
      break;

    case 'TOKEN_STREAM': {
      const token = (event.payload.token as string) ?? '';
      const existing = streamBuffers.get(event.correlationId) ?? '';
      streamBuffers.set(event.correlationId, existing + token);
      break;
    }

    case 'TASK_COMPLETE': {
      // Flush any buffered stream tokens immediately
      const buffered = streamBuffers.get(event.correlationId);
      if (buffered) {
        useChatStore.getState().updateMessage(event.correlationId, { text: buffered, status: 'done' });
        streamBuffers.delete(event.correlationId);
      } else {
        const text = ((event.payload.text as string) ?? '').trim();
        const hasApproval = !!(event.payload.hasApproval);
        useChatStore.getState().updateMessage(event.correlationId, {
          text: text || useChatStore.getState().messages.find(m => m.correlationId === event.correlationId)?.text ?? '',
          status: 'done',
          hasApproval,
        });
      }
      useWsStore.getState().removePending(event.correlationId);
      break;
    }

    case 'ERROR':
      useChatStore.getState().updateMessage(event.correlationId, {
        text: `Error: ${(event.payload.message as string) ?? 'Unknown error'}`,
        status: 'error',
      });
      useWsStore.getState().removePending(event.correlationId);
      break;

    default:
      break;
  }
}
