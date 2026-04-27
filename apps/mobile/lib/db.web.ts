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

// ─── Pending contacts (localStorage stub) ───

export interface PendingContact {
  id: string;
  payload: string;
  created_at: string;
}

const PENDING_CONTACTS_KEY = 'claw:pending_contacts';

function loadPendingContactsList(): PendingContact[] {
  try {
    return JSON.parse(localStorage.getItem(PENDING_CONTACTS_KEY) ?? '[]') as PendingContact[];
  } catch {
    return [];
  }
}

function savePendingContactsList(list: PendingContact[]): void {
  localStorage.setItem(PENDING_CONTACTS_KEY, JSON.stringify(list));
}

export async function savePendingContact(contact: PendingContact): Promise<void> {
  const list = loadPendingContactsList();
  const idx = list.findIndex(c => c.id === contact.id);
  if (idx >= 0) list[idx] = contact; else list.push(contact);
  savePendingContactsList(list);
}

export async function loadPendingContacts(): Promise<PendingContact[]> {
  return loadPendingContactsList().sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function removePendingContact(id: string): Promise<void> {
  savePendingContactsList(loadPendingContactsList().filter(c => c.id !== id));
}

// ─── Open house guest helpers (localStorage stub) ───

export interface StoredGuest {
  id: string;
  name: string;
  phone: string | null;
  working_with_agent: number;
  brain_dump_text: string | null;
  created_at: number;
  synced: number;
}

const GUESTS_KEY = 'claw:open_house_guests';

function loadGuests(): StoredGuest[] {
  try {
    return JSON.parse(localStorage.getItem(GUESTS_KEY) ?? '[]') as StoredGuest[];
  } catch {
    return [];
  }
}

function persistGuests(guests: StoredGuest[]): void {
  localStorage.setItem(GUESTS_KEY, JSON.stringify(guests));
}

export async function saveGuest(guest: StoredGuest): Promise<void> {
  const guests = loadGuests();
  const idx = guests.findIndex(g => g.id === guest.id);
  if (idx >= 0) {
    guests[idx] = guest;
  } else {
    guests.push(guest);
  }
  persistGuests(guests);
}

export async function loadTodayGuests(): Promise<StoredGuest[]> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  return loadGuests()
    .filter(g => g.created_at >= startOfDay.getTime())
    .sort((a, b) => b.created_at - a.created_at);
}

export async function markGuestSynced(id: string): Promise<void> {
  const guests = loadGuests();
  const g = guests.find(guest => guest.id === id);
  if (g) {
    g.synced = 1;
    persistGuests(guests);
  }
}

export async function loadUnsyncedGuests(): Promise<StoredGuest[]> {
  return loadGuests()
    .filter(g => g.synced === 0)
    .sort((a, b) => a.created_at - b.created_at);
}

// ─── Cached properties (localStorage stub) ───────────────────────────────────

const CACHED_PROPS_KEY = 'claw:cached_properties';

function loadCachedProps(): Array<{ id: string; data: string; cached_at: number }> {
  try {
    return JSON.parse(localStorage.getItem(CACHED_PROPS_KEY) ?? '[]') as Array<{ id: string; data: string; cached_at: number }>;
  } catch { return []; }
}

export async function cacheProperty(id: string, data: string): Promise<void> {
  const list = loadCachedProps().filter(p => p.id !== id);
  list.push({ id, data, cached_at: Date.now() });
  localStorage.setItem(CACHED_PROPS_KEY, JSON.stringify(list));
}

export async function getCachedProperty(id: string): Promise<string | null> {
  return loadCachedProps().find(p => p.id === id)?.data ?? null;
}

// ─── Pending tour notes (localStorage stub) ──────────────────────────────────

export interface PendingTourNote {
  id: string;
  showing_day_property_id: string;
  transcript: string;
  created_at: number;
}

const PENDING_NOTES_KEY = 'claw:pending_tour_notes';

function loadNotes(): PendingTourNote[] {
  try {
    return JSON.parse(localStorage.getItem(PENDING_NOTES_KEY) ?? '[]') as PendingTourNote[];
  } catch { return []; }
}

export async function savePendingTourNote(note: PendingTourNote): Promise<void> {
  const list = loadNotes().filter(n => n.id !== note.id);
  list.push(note);
  localStorage.setItem(PENDING_NOTES_KEY, JSON.stringify(list));
}

export async function loadPendingTourNotes(): Promise<PendingTourNote[]> {
  return loadNotes().sort((a, b) => a.created_at - b.created_at);
}

export async function removePendingTourNote(id: string): Promise<void> {
  localStorage.setItem(PENDING_NOTES_KEY, JSON.stringify(loadNotes().filter(n => n.id !== id)));
}
