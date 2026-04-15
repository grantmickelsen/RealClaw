import { useEffect } from 'react';
import { useWsStore } from '../store/ws';

type WsEventHandler = (payload: Record<string, unknown>, correlationId: string) => void;

/**
 * Subscribe to a specific WebSocket event type.
 * The handler fires whenever a message of that type is received.
 * Cleans up automatically on unmount.
 */
export function useWsEvents(eventType: string, handler: WsEventHandler): void {
  const socket = useWsStore(state => state.socket);

  useEffect(() => {
    if (!socket) return;

    const onMessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string) as {
          type: string;
          correlationId: string;
          payload: Record<string, unknown>;
        };
        if (msg.type === eventType) {
          handler(msg.payload, msg.correlationId);
        }
      } catch {
        // ignore malformed messages
      }
    };

    socket.addEventListener('message', onMessage);
    return () => socket.removeEventListener('message', onMessage);
  }, [socket, eventType, handler]);
}
