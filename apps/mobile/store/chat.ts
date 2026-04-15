import { create } from 'zustand';

export type MessageRole = 'user' | 'assistant';
export type MessageStatus = 'sending' | 'streaming' | 'done' | 'error';

export interface ChatMessage {
  id: string;
  correlationId: string;
  role: MessageRole;
  text: string;
  status: MessageStatus;
  timestamp: string;
  agentId?: string;
  hasApproval?: boolean;
  approvalId?: string;
}

interface ChatState {
  messages: ChatMessage[];
  addMessage(msg: ChatMessage): void;
  updateMessage(correlationId: string, updates: Partial<ChatMessage>): void;
  appendStreamChunk(correlationId: string, chunk: string): void;
  clearMessages(): void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],

  addMessage(msg) {
    set(state => ({ messages: [...state.messages, msg] }));
  },

  updateMessage(correlationId, updates) {
    set(state => ({
      messages: state.messages.map(m =>
        m.correlationId === correlationId ? { ...m, ...updates } : m,
      ),
    }));
  },

  appendStreamChunk(correlationId, chunk) {
    set(state => ({
      messages: state.messages.map(m =>
        m.correlationId === correlationId
          ? { ...m, text: m.text + chunk, status: 'streaming' as MessageStatus }
          : m,
      ),
    }));
  },

  clearMessages() {
    set({ messages: [] });
  },
}));
