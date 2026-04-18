/**
 * Web stub for db.ts — uses localStorage instead of expo-sqlite/WASM.
 * Metro picks this file over db.ts when bundling for web.
 */

export interface StoredMessage {
  id: string;
  correlation_id: string;
  role: 'user' | 'assistant';
  text: string;
  status: string;
  agent_id: string | null;
  has_approval: number;
  approval_id: string | null;
  timestamp: string;
  synced: number;
}

export interface QueuedMessage {
  id: string;
  correlation_id: string;
  text: string;
  platform: string;
  created_at: string;
  retry_count: number;
}

const MESSAGES_KEY = 'claw:messages';
const QUEUE_KEY = 'claw:offline_queue';

function loadMessages(): StoredMessage[] {
  try {
    return JSON.parse(localStorage.getItem(MESSAGES_KEY) ?? '[]') as StoredMessage[];
  } catch {
    return [];
  }
}

function saveMessages(msgs: StoredMessage[]): void {
  localStorage.setItem(MESSAGES_KEY, JSON.stringify(msgs));
}

function loadQueue(): QueuedMessage[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]') as QueuedMessage[];
  } catch {
    return [];
  }
}

function saveQueue(q: QueuedMessage[]): void {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
}

// ─── Message persistence ───

export async function saveMessage(msg: StoredMessage): Promise<void> {
  const msgs = loadMessages();
  const idx = msgs.findIndex(m => m.id === msg.id);
  if (idx >= 0) {
    msgs[idx] = msg;
  } else {
    msgs.push(msg);
  }
  saveMessages(msgs);
}

export async function loadRecentMessages(limit = 50): Promise<StoredMessage[]> {
  const msgs = loadMessages();
  return msgs.sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, limit);
}

export async function updateMessageText(correlationId: string, text: string, status: string): Promise<void> {
  const msgs = loadMessages();
  const msg = msgs.find(m => m.correlation_id === correlationId);
  if (msg) {
    msg.text = text;
    msg.status = status;
    msg.synced = 1;
    saveMessages(msgs);
  }
}

// ─── Offline queue ───

export async function enqueueMessage(msg: QueuedMessage): Promise<void> {
  const q = loadQueue();
  const idx = q.findIndex(m => m.correlation_id === msg.correlation_id);
  if (idx >= 0) {
    q[idx] = msg;
  } else {
    q.push(msg);
  }
  saveQueue(q);
}

export async function dequeueMessages(): Promise<QueuedMessage[]> {
  const q = loadQueue();
  return q.sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(0, 20);
}

export async function removeFromQueue(correlationId: string): Promise<void> {
  saveQueue(loadQueue().filter(m => m.correlation_id !== correlationId));
}

export async function incrementRetry(correlationId: string): Promise<void> {
  const q = loadQueue();
  const item = q.find(m => m.correlation_id === correlationId);
  if (item) {
    item.retry_count += 1;
    saveQueue(q);
  }
}
