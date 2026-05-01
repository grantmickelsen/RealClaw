import { create } from 'zustand';

export interface ExtractedSignals {
  budget?: { value: string; confidence: 'high' | 'medium' | 'low' };
  timeline?: { value: string; confidence: 'high' | 'medium' | 'low' };
  preferences?: string[];
  objections?: string[];
  competitorMentions?: string[];
  urgencyLevel?: 'low' | 'medium' | 'high' | 'critical';
  sentimentArc?: 'positive' | 'neutral' | 'negative';
}

export interface SmsConversation {
  contactId: string | null;
  contactName: string | null;
  phone: string | null;
  lastMessage: string;
  lastMessageAt: string;
  lastDirection: 'inbound' | 'outbound';
  unreadCount: number;
  latestSignals: ExtractedSignals | null;
}

export interface SmsMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  body: string;
  status: string;
  sentVia: string;
  extractedSignals: ExtractedSignals | null;
  createdAt: string;
  twilioSid: string | null;
}

interface SmsState {
  conversations: SmsConversation[];
  threads: Record<string, SmsMessage[]>;
  suggestions: Record<string, string[]>;
  suggestionsLoading: Record<string, boolean>;

  setConversations(conversations: SmsConversation[]): void;
  upsertConversation(conv: SmsConversation): void;
  setThread(contactId: string, messages: SmsMessage[]): void;
  appendMessage(contactId: string, msg: SmsMessage): void;
  updateMessageStatus(twilioSid: string, status: string): void;
  updateMessageSignals(msgId: string, signals: ExtractedSignals): void;
  setSuggestions(contactId: string, suggestions: string[]): void;
  setSuggestionsLoading(contactId: string, loading: boolean): void;
  markRead(contactId: string): void;
}

export const EMPTY_MESSAGES: SmsMessage[] = [];
export const EMPTY_SUGGESTIONS: string[] = [];

export const useSmsStore = create<SmsState>((set, get) => ({
  conversations: [],
  threads: {},
  suggestions: {},
  suggestionsLoading: {},

  setConversations(conversations) {
    set({ conversations: conversations ?? [] });
  },

  upsertConversation(conv) {
    set(state => {
      const key = conv.contactId ?? conv.phone ?? '';
      const existing = state.conversations.findIndex(
        c => (c.contactId && c.contactId === conv.contactId) || (!c.contactId && c.phone === conv.phone),
      );
      if (existing >= 0) {
        const updated = [...state.conversations];
        updated[existing] = conv;
        return { conversations: updated };
      }
      return { conversations: [conv, ...state.conversations] };
    });
  },

  setThread(contactId, messages) {
    set(state => ({ threads: { ...state.threads, [contactId]: messages } }));
  },

  appendMessage(contactId, msg) {
    set(state => {
      const existing = state.threads[contactId] ?? [];
      const deduped = existing.filter(m => m.id !== msg.id);
      return { threads: { ...state.threads, [contactId]: [...deduped, msg] } };
    });
  },

  updateMessageStatus(twilioSid, status) {
    set(state => {
      const threads = { ...state.threads };
      for (const [contactId, msgs] of Object.entries(threads)) {
        const updated = msgs.map(m => m.twilioSid === twilioSid ? { ...m, status } : m);
        if (updated.some((m, i) => m !== msgs[i])) {
          threads[contactId] = updated;
        }
      }
      return { threads };
    });
  },

  updateMessageSignals(msgId, signals) {
    set(state => {
      const threads = { ...state.threads };
      for (const [contactId, msgs] of Object.entries(threads)) {
        const updated = msgs.map(m => m.id === msgId ? { ...m, extractedSignals: signals } : m);
        if (updated.some((m, i) => m !== msgs[i])) {
          threads[contactId] = updated;
        }
      }
      return { threads };
    });
  },

  setSuggestions(contactId, suggestions) {
    set(state => ({
      suggestions: { ...state.suggestions, [contactId]: suggestions },
      suggestionsLoading: { ...state.suggestionsLoading, [contactId]: false },
    }));
  },

  setSuggestionsLoading(contactId, loading) {
    set(state => ({ suggestionsLoading: { ...state.suggestionsLoading, [contactId]: loading } }));
  },

  markRead(contactId) {
    set(state => ({
      conversations: state.conversations.map(c =>
        c.contactId === contactId ? { ...c, unreadCount: 0 } : c,
      ),
    }));
  },
}));
