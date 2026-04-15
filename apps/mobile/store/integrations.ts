import { create } from 'zustand';

export interface IntegrationStatusEntry {
  id: string;
  status: 'connected' | 'degraded' | 'disconnected' | 'not_configured';
  lastSuccessfulCall: string | null;
  lastError: string | null;
}

interface IntegrationsState {
  statuses: IntegrationStatusEntry[];
  setStatuses(statuses: IntegrationStatusEntry[]): void;
  updateStatus(id: string, updates: Partial<IntegrationStatusEntry>): void;
}

export const useIntegrationsStore = create<IntegrationsState>((set) => ({
  statuses: [],

  setStatuses(statuses) { set({ statuses }); },

  updateStatus(id, updates) {
    set(state => ({
      statuses: state.statuses.map(s => s.id === id ? { ...s, ...updates } : s),
    }));
  },
}));
