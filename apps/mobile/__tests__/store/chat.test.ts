import { act } from 'react';
import { useChatStore, type ChatMessage } from '../../store/chat';

function makeMsg(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-1',
    correlationId: 'corr-1',
    role: 'user',
    text: 'Hello',
    status: 'done',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  useChatStore.setState({ messages: [] });
});

describe('useChatStore', () => {
  it('starts with empty messages array', () => {
    expect(useChatStore.getState().messages).toHaveLength(0);
  });

  it('addMessage appends a message', () => {
    const msg = makeMsg();
    act(() => {
      useChatStore.getState().addMessage(msg);
    });
    expect(useChatStore.getState().messages).toHaveLength(1);
    expect(useChatStore.getState().messages[0]).toEqual(msg);
  });

  it('addMessage preserves insertion order', () => {
    const m1 = makeMsg({ id: 'a', correlationId: 'c1' });
    const m2 = makeMsg({ id: 'b', correlationId: 'c2' });
    act(() => {
      useChatStore.getState().addMessage(m1);
      useChatStore.getState().addMessage(m2);
    });
    const msgs = useChatStore.getState().messages;
    expect(msgs[0].id).toBe('a');
    expect(msgs[1].id).toBe('b');
  });

  it('updateMessage patches matching message by correlationId', () => {
    act(() => {
      useChatStore.getState().addMessage(makeMsg({ text: 'original', status: 'sending' }));
    });
    act(() => {
      useChatStore.getState().updateMessage('corr-1', { status: 'done', text: 'updated' });
    });
    const msg = useChatStore.getState().messages[0];
    expect(msg.text).toBe('updated');
    expect(msg.status).toBe('done');
  });

  it('updateMessage leaves non-matching messages untouched', () => {
    act(() => {
      useChatStore.getState().addMessage(makeMsg({ correlationId: 'c1', text: 'A' }));
      useChatStore.getState().addMessage(makeMsg({ id: 'msg-2', correlationId: 'c2', text: 'B' }));
    });
    act(() => {
      useChatStore.getState().updateMessage('c1', { text: 'A-updated' });
    });
    const msgs = useChatStore.getState().messages;
    expect(msgs[0].text).toBe('A-updated');
    expect(msgs[1].text).toBe('B');
  });

  it('appendStreamChunk concatenates text and sets status to streaming', () => {
    act(() => {
      useChatStore.getState().addMessage(makeMsg({ text: '', status: 'sending' }));
    });
    act(() => {
      useChatStore.getState().appendStreamChunk('corr-1', 'Hello');
    });
    act(() => {
      useChatStore.getState().appendStreamChunk('corr-1', ' world');
    });
    const msg = useChatStore.getState().messages[0];
    expect(msg.text).toBe('Hello world');
    expect(msg.status).toBe('streaming');
  });

  it('appendStreamChunk on unknown correlationId is a no-op', () => {
    act(() => {
      useChatStore.getState().addMessage(makeMsg({ text: 'unchanged' }));
    });
    act(() => {
      useChatStore.getState().appendStreamChunk('no-such-id', 'chunk');
    });
    expect(useChatStore.getState().messages[0].text).toBe('unchanged');
  });

  it('clearMessages empties the array', () => {
    act(() => {
      useChatStore.getState().addMessage(makeMsg());
      useChatStore.getState().addMessage(makeMsg({ id: 'msg-2', correlationId: 'c2' }));
    });
    act(() => {
      useChatStore.getState().clearMessages();
    });
    expect(useChatStore.getState().messages).toHaveLength(0);
  });
});
