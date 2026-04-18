import { create } from 'zustand';

export type ApprovalActionType =
  | 'send_email'
  | 'send_sms'
  | 'send_linkedin_dm'
  | 'modify_calendar'
  | 'post_social'
  | 'send_document'
  | 'financial_action';

export interface ApprovalItem {
  index: number;
  actionType: ApprovalActionType;
  preview: string;
  fullContent?: string;
  medium: string;
  recipients: string[];
  originatingAgent: string;
  taskResultId: string;
}

export interface PendingDecision {
  index: number;
  decision: 'approve' | 'edit' | 'cancel' | 'shared';
  editInstructions?: string;
}

interface ApprovalCarouselState {
  approvalId: string | null;
  items: ApprovalItem[];
  decisions: PendingDecision[];
  currentIndex: number;

  setCarousel(approvalId: string, items: ApprovalItem[]): void;
  recordDecision(decision: PendingDecision): void;
  advance(): void;
  reset(): void;
  isComplete(): boolean;
}

export const useApprovalStore = create<ApprovalCarouselState>((set, get) => ({
  approvalId: null,
  items: [],
  decisions: [],
  currentIndex: 0,

  setCarousel(approvalId, items) {
    set({ approvalId, items, decisions: [], currentIndex: 0 });
  },

  recordDecision(decision) {
    set(state => ({
      decisions: [...state.decisions.filter(d => d.index !== decision.index), decision],
    }));
  },

  advance() {
    set(state => ({ currentIndex: state.currentIndex + 1 }));
  },

  reset() {
    set({ approvalId: null, items: [], decisions: [], currentIndex: 0 });
  },

  isComplete() {
    const { items, currentIndex } = get();
    return currentIndex >= items.length;
  },
}));
