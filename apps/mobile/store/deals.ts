import { create } from 'zustand';
import { authedFetch } from '../lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

export type DealStage =
  | 'pre_offer' | 'offer_drafting' | 'mutual_acceptance'
  | 'contingency' | 'clear_to_close' | 'closed' | 'cancelled';

export type MilestoneStatus = 'pending' | 'in_progress' | 'complete' | 'overdue' | 'waived';

export type DocumentStatus = 'required' | 'uploaded' | 'signed' | 'waived' | 'n_a';

export interface DealSummary {
  id: string;
  address: string;
  stage: DealStage;
  deal_type: 'buyer' | 'seller' | 'dual';
  closing_date: string | null;
  purchase_price: string | null;
  buyer_name: string | null;
  seller_name: string | null;
  contact_id: string | null;
  milestones?: DealMilestone[];
}

export interface DealDetail extends DealSummary {
  mls_number: string | null;
  earnest_money: string | null;
  earnest_due_date: string | null;
  escrow_company: string | null;
  escrow_number: string | null;
  acceptance_date: string | null;
  year_built: number | null;
  has_hoa: boolean;
  seller_foreign_person: boolean;
  seller_concessions: string | null;
  status: string;
  milestones: DealMilestone[];
  documents: DealDocument[];
  alerts: DealAlert[];
}

export interface DealMilestone {
  id: string;
  deal_id: string;
  milestone_type: string;
  label: string;
  deadline: string | null;
  completed_at: string | null;
  waived_at: string | null;
  is_blocking: boolean;
  status: MilestoneStatus;
  sequence_order: number;
  notes: string | null;
}

export interface DealDocument {
  id: string;
  deal_id: string;
  doc_type: string;
  name: string;
  status: DocumentStatus;
  is_blocking: boolean;
  due_date: string | null;
  notes: string | null;
  storage_url: string | null;
}

export interface DealAlert {
  id: string;
  deal_id: string;
  priority: 0 | 1;
  message: string;
  action_type: string | null;
  action_label: string | null;
  action_payload: Record<string, unknown> | null;
  created_at: string;
}

// ─── Store ────────────────────────────────────────────────────────────────────

interface DealsState {
  alerts: DealAlert[];
  activeDeals: DealSummary[];
  dealDetail: DealDetail | null;
  loadingList: boolean;
  loadingDetail: boolean;
  ingestLoading: boolean;

  loadAlerts(): Promise<void>;
  loadDeals(): Promise<void>;
  loadDeal(id: string): Promise<void>;
  dismissAlert(alertId: string): Promise<void>;
  completeMilestone(dealId: string, milestoneId: string): Promise<void>;
  waiveMilestone(dealId: string, milestoneId: string): Promise<void>;
  updateDocument(dealId: string, docId: string, status: DocumentStatus): Promise<void>;
  ingestContract(text: string): Promise<{ dealId?: string; message: string }>;

  // WS event handlers
  handleDealIngestReady(payload: { dealId: string; address: string; complianceCount: number }): void;
  handleDealAlert(payload: { alertId: string; dealId: string; priority: number; message: string; actionType: string | null; actionLabel: string | null }): void;
  handleMilestoneUpdate(payload: { dealId: string; milestoneId: string; status: MilestoneStatus }): void;
  handleComplianceReady(payload: { dealId: string; documentCount: number; blockingCount: number }): void;
}

export const useDealsStore = create<DealsState>((set, get) => ({
  alerts: [],
  activeDeals: [],
  dealDetail: null,
  loadingList: false,
  loadingDetail: false,
  ingestLoading: false,

  async loadAlerts() {
    set({ loadingList: true });
    try {
      const res = await authedFetch('/v1/deals/alerts');
      if (res.ok) {
        const data = await res.json() as { alerts: DealAlert[] };
        set({ alerts: data.alerts });
      }
    } catch { /* silent */ } finally {
      set({ loadingList: false });
    }
  },

  async loadDeals() {
    set({ loadingList: true });
    try {
      const res = await authedFetch('/v1/deals');
      if (res.ok) {
        const data = await res.json() as { deals: DealSummary[] };
        set({ activeDeals: data.deals });
      }
    } catch { /* silent */ } finally {
      set({ loadingList: false });
    }
  },

  async loadDeal(id) {
    set({ loadingDetail: true });
    try {
      const res = await authedFetch(`/v1/deals/${id}`);
      if (res.ok) {
        const data = await res.json() as { deal: DealDetail };
        set({ dealDetail: data.deal });
      }
    } catch { /* silent */ } finally {
      set({ loadingDetail: false });
    }
  },

  async dismissAlert(alertId) {
    set(s => ({ alerts: s.alerts.filter(a => a.id !== alertId) }));
    try {
      await authedFetch(`/v1/deals/alerts/${alertId}/dismiss`, { method: 'POST' });
    } catch { /* revert not needed — optimistic dismiss */ }
  },

  async completeMilestone(dealId, milestoneId) {
    set(s => ({
      dealDetail: s.dealDetail?.id === dealId ? {
        ...s.dealDetail,
        milestones: s.dealDetail.milestones.map(m =>
          m.id === milestoneId ? { ...m, status: 'complete', completed_at: new Date().toISOString() } : m,
        ),
      } : s.dealDetail,
    }));
    try {
      await authedFetch(`/v1/deals/${dealId}/milestones/${milestoneId}/complete`, { method: 'POST' });
    } catch { /* silent */ }
  },

  async waiveMilestone(dealId, milestoneId) {
    set(s => ({
      dealDetail: s.dealDetail?.id === dealId ? {
        ...s.dealDetail,
        milestones: s.dealDetail.milestones.map(m =>
          m.id === milestoneId ? { ...m, status: 'waived', waived_at: new Date().toISOString() } : m,
        ),
      } : s.dealDetail,
    }));
    try {
      await authedFetch(`/v1/deals/${dealId}/milestones/${milestoneId}/waive`, { method: 'POST' });
    } catch { /* silent */ }
  },

  async updateDocument(dealId, docId, status) {
    set(s => ({
      dealDetail: s.dealDetail?.id === dealId ? {
        ...s.dealDetail,
        documents: s.dealDetail.documents.map(d =>
          d.id === docId ? { ...d, status } : d,
        ),
      } : s.dealDetail,
    }));
    try {
      await authedFetch(`/v1/deals/${dealId}/documents/${docId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
    } catch { /* silent */ }
  },

  async ingestContract(text) {
    set({ ingestLoading: true });
    try {
      const res = await authedFetch('/v1/deals/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractText: text }),
      });
      const data = await res.json() as { text?: string; dealId?: string; message?: string };
      const message = data.text ?? data.message ?? (res.ok ? 'Deal created.' : 'Failed to create deal.');
      if (res.ok && data.dealId) {
        void get().loadDeals();
        return { dealId: data.dealId as string, message };
      }
      return { message };
    } catch (e) {
      return { message: 'Network error. Please try again.' };
    } finally {
      set({ ingestLoading: false });
    }
  },

  // ─── WS event handlers ──────────────────────────────────────────────────

  handleDealIngestReady({ dealId, address }) {
    void get().loadDeals();
  },

  handleDealAlert(payload) {
    const newAlert: DealAlert = {
      id: payload.alertId,
      deal_id: payload.dealId,
      priority: (payload.priority === 0 ? 0 : 1) as 0 | 1,
      message: payload.message,
      action_type: payload.actionType,
      action_label: payload.actionLabel,
      action_payload: null,
      created_at: new Date().toISOString(),
    };
    set(s => ({
      alerts: [newAlert, ...s.alerts.filter(a => a.id !== newAlert.id)],
    }));
  },

  handleMilestoneUpdate({ dealId, milestoneId, status }) {
    set(s => ({
      dealDetail: s.dealDetail?.id === dealId ? {
        ...s.dealDetail,
        milestones: s.dealDetail.milestones.map(m =>
          m.id === milestoneId ? { ...m, status } : m,
        ),
      } : s.dealDetail,
    }));
  },

  handleComplianceReady({ dealId }) {
    if (get().dealDetail?.id === dealId) {
      void get().loadDeal(dealId);
    }
  },
}));
