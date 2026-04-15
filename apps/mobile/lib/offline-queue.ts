import { useWsStore } from '../store/ws';
import { dequeueMessages, removeFromQueue, incrementRetry } from './db';
import { authedFetch } from './api';

const MAX_RETRY = 3;

/**
 * Drain the offline queue — called when network comes back or WS reconnects.
 * Each queued message is submitted via POST /v1/messages.
 * Messages that fail permanently (retry > MAX_RETRY) are dropped with a console warning.
 */
export async function drainOfflineQueue(): Promise<void> {
  const { status } = useWsStore.getState();
  if (status !== 'connected') return;

  const items = await dequeueMessages();
  for (const item of items) {
    if (item.retry_count >= MAX_RETRY) {
      console.warn('[OfflineQueue] Dropping message after max retries:', item.correlation_id);
      await removeFromQueue(item.correlation_id);
      continue;
    }

    try {
      const res = await authedFetch('/v1/messages', {
        method: 'POST',
        body: JSON.stringify({
          platform: item.platform,
          content: item.text,
          correlationId: item.correlation_id,
        }),
      });

      if (res.ok) {
        await removeFromQueue(item.correlation_id);
      } else {
        await incrementRetry(item.correlation_id);
      }
    } catch {
      await incrementRetry(item.correlation_id);
    }
  }
}
