import { create } from 'zustand';

export type WsStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

interface WsState {
  status: WsStatus;
  socket: WebSocket | null;
  pendingCorrelationIds: Set<string>;
  setStatus(status: WsStatus): void;
  setSocket(socket: WebSocket | null): void;
  addPending(correlationId: string): void;
  removePending(correlationId: string): void;
}

export const useWsStore = create<WsState>((set) => ({
  status: 'disconnected',
  socket: null,
  pendingCorrelationIds: new Set(),

  setStatus(status) { set({ status }); },
  setSocket(socket) { set({ socket }); },
  addPending(correlationId) {
    set(state => ({
      pendingCorrelationIds: new Set([...state.pendingCorrelationIds, correlationId]),
    }));
  },
  removePending(correlationId) {
    set(state => {
      const next = new Set(state.pendingCorrelationIds);
      next.delete(correlationId);
      return { pendingCorrelationIds: next };
    });
  },
}));
