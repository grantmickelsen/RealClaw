import { create } from 'zustand';

export interface BriefingItem {
  id: string;
  type: 'follow_up' | 'deal_deadline' | 'new_lead' | 'showing_prep' | 'compliance_flag' | 'market_alert';
  urgencyScore: number;
  summaryText: string;
  draftContent: string | null;
  draftMedium: 'sms' | 'email' | 'note' | null;
  suggestedAction: string | null;
  contactId: string | null;
  createdAt: string;
}

interface BriefingState {
  items: BriefingItem[];
  loading: boolean;
  setItems(items: BriefingItem[]): void;
  dismissItem(id: string): void;
  clear(): void;
}

export const useBriefingStore = create<BriefingState>((set) => ({
  items: [],
  loading: false,
  setItems: (items) => set({ items, loading: false }),
  dismissItem: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
  clear: () => set({ items: [], loading: false }),
}));
