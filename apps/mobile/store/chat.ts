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
  prependMessages(msgs: ChatMessage[]): void;
  updateMessage(correlationId: string, updates: Partial<ChatMessage>): void;
  appendStreamChunk(correlationId: string, chunk: string): void;
  clearMessages(): void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],

  addMessage(msg) {
    set(state => ({ messages: [...state.messages, msg] }));
  },

  // Batch-load historical messages in one store update (avoids N re-renders)
  prependMessages(msgs) {
    set(state => {
      const existingIds = new Set(state.messages.map(m => m.id));
      const newOnes = msgs.filter(m => !existingIds.has(m.id));
      return newOnes.length > 0
        ? { messages: [...newOnes, ...state.messages] }
        : state;
    });
  },

  updateMessage(correlationId, updates) {
    set(state => ({
      messages: state.messages.map(m =>
        m.correlationId === correlationId && m.role === 'assistant' ? { ...m, ...updates } : m,
      ),
    }));
  },

  appendStreamChunk(correlationId, chunk) {
    set(state => ({
      messages: state.messages.map(m =>
        m.correlationId === correlationId && m.role === 'assistant'
          ? { ...m, text: m.text + chunk, status: 'streaming' as MessageStatus }
          : m,
      ),
    }));
  },

  clearMessages() {
    set({ messages: [] });
  },
}));
