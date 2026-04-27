import { useWsStore } from '../store/ws';
import { loadPendingContacts, removePendingContact } from './db';
import { authedFetch } from './api';

export async function drainPendingContacts(): Promise<void> {
  const { status } = useWsStore.getState();
  if (status !== 'connected') return;

  const items = await loadPendingContacts();
  for (const item of items) {
    try {
      const res = await authedFetch('/v1/contacts', {
        method: 'POST',
        body: item.payload,
      });
      if (res.ok) {
        await removePendingContact(item.id);
      }
    } catch {
      // leave in queue, retry on next reconnect
    }
  }
}
