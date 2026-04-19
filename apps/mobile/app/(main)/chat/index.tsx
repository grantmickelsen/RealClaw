import { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Text,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { v4 as uuidv4 } from 'uuid';
import { useChatStore } from '../../../store/chat';
import { useWsStore } from '../../../store/ws';
import { MessageList } from '../../../components/chat/MessageList';
import { SkillPicker } from '../../../components/chat/SkillPicker';
import { VoiceInput } from '../../../components/VoiceInput';
import { authedFetch } from '../../../lib/api';
import { saveMessage, loadRecentMessages, enqueueMessage } from '../../../lib/db';
import { useNetworkStatus } from '../../../hooks/useNetworkStatus';
import { drainOfflineQueue } from '../../../lib/offline-queue';
import type { Skill } from '../../../constants/skills';

export default function ChatScreen() {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [inputBarHeight, setInputBarHeight] = useState(64);
  const inputRef = useRef<TextInput>(null);

  // ─── Skill picker state ───────────────────────────────────────────────
  const slashMatch = input.match(/^\/(\S*)$/);
  const pickerVisible = slashMatch !== null;
  const pickerQuery = slashMatch ? slashMatch[1]! : '';

  const handleSkillSelect = useCallback((skill: Skill) => {
    setInput(skill.template);
    // Focus and place cursor at first bracket for easy editing
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      const idx = skill.template.indexOf('[');
      if (idx >= 0) {
        inputRef.current?.setNativeProps?.({ selection: { start: idx, end: skill.template.indexOf(']') + 1 } });
      }
    });
  }, []);

  const messages = useChatStore(s => s.messages);
  const addMessage = useChatStore(s => s.addMessage);
  const prependMessages = useChatStore(s => s.prependMessages);
  const updateMessage = useChatStore(s => s.updateMessage);
  const addPending = useWsStore(s => s.addPending);
  const pendingSize = useWsStore(s => s.pendingCorrelationIds.size);
  const wsStatus = useWsStore(s => s.status);
  const { isConnected } = useNetworkStatus();

  // Load persisted messages on mount — one store update, not N
  useEffect(() => {
    loadRecentMessages(50).then(stored => {
      const batch = stored.map(row => ({
        id: row.id,
        correlationId: row.correlation_id,
        role: row.role as 'user' | 'assistant',
        text: row.text,
        status: 'done' as const,
        timestamp: row.timestamp,
        hasApproval: row.has_approval === 1,
        approvalId: row.approval_id ?? undefined,
      }));
      prependMessages(batch);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Drain offline queue when WS reconnects
  useEffect(() => {
    if (wsStatus === 'connected' && isConnected) {
      drainOfflineQueue();
    }
  }, [wsStatus, isConnected]);

  const hasInFlight = pendingSize > 0;

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    const correlationId = uuidv4();
    const messageId = uuidv4();
    const timestamp = new Date().toISOString();

    const userMsg = {
      id: messageId,
      correlationId,
      role: 'user' as const,
      text: trimmed,
      status: 'done' as const,
      timestamp,
    };

    addMessage(userMsg);
    await saveMessage({ ...userMsg, correlation_id: correlationId, role: 'user', has_approval: 0, approval_id: null, synced: 0 });

    const assistantId = uuidv4();
    const assistantMsg = {
      id: assistantId,
      correlationId,
      role: 'assistant' as const,
      text: '',
      status: 'sending' as const,
      timestamp: new Date().toISOString(),
    };
    addMessage(assistantMsg);

    setInput('');
    setSending(true);
    addPending(correlationId);

    if (!isConnected || wsStatus !== 'connected') {
      // Queue for offline drain
      await enqueueMessage({
        id: uuidv4(),
        correlation_id: correlationId,
        text: trimmed,
        platform: 'mobile',
        created_at: timestamp,
        retry_count: 0,
      });
      updateMessage(correlationId, { status: 'error', text: '(queued — will send when online)' });
      setSending(false);
      return;
    }

    try {
      const res = await authedFetch('/v1/messages', {
        method: 'POST',
        body: JSON.stringify({
          platform: 'mobile',
          content: trimmed,
          correlationId,
        }),
      });

      if (!res.ok) {
        updateMessage(correlationId, { status: 'error', text: 'Failed to send message' });
      }
      // Response arrives via WS TASK_COMPLETE — don't update here
    } catch {
      updateMessage(correlationId, { status: 'error', text: 'Network error' });
    } finally {
      setSending(false);
    }
  }, [sending, isConnected, wsStatus, addMessage, updateMessage, addPending]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>RealClaw</Text>
        <View style={[styles.statusDot, { backgroundColor: wsStatus === 'connected' ? '#34c759' : '#ff9500' }]} />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <View style={styles.list}>
          <MessageList
            messages={messages}
            hasInFlight={hasInFlight}
            onApprovalResolved={() => {}}
          />
        </View>

        <View
          style={styles.inputRow}
          onLayout={e => setInputBarHeight(e.nativeEvent.layout.height)}
        >
          <VoiceInput
            onTranscript={text => {
              setInput(text);
              inputRef.current?.focus();
            }}
            disabled={sending}
          />

          <TextInput
            ref={inputRef}
            style={styles.textInput}
            value={input}
            onChangeText={setInput}
            placeholder="Message Claw… (type / for skills)"
            placeholderTextColor="#aaa"
            multiline
            maxLength={4000}
            returnKeyType="send"
            onSubmitEditing={() => sendMessage(input)}
            editable={!sending}
          />

          <TouchableOpacity
            style={[styles.sendButton, (!input.trim() || sending) && styles.sendButtonDisabled]}
            onPress={() => sendMessage(input)}
            disabled={!input.trim() || sending}
          >
            <Text style={styles.sendIcon}>↑</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <SkillPicker
        visible={pickerVisible}
        query={pickerQuery}
        onSelect={handleSkillSelect}
        onDismiss={() => setInput('')}
        bottomOffset={inputBarHeight}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
    gap: 8,
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#0066FF' },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  list: { flex: 1 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e0e0e0',
    gap: 8,
    backgroundColor: '#fff',
  },
  textInput: {
    flex: 1,
    backgroundColor: '#f0f0f5',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 16,
    maxHeight: 120,
    color: '#1a1a1a',
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#0066FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: { backgroundColor: '#b0c8ff' },
  sendIcon: { color: '#fff', fontSize: 20, fontWeight: '700' },
});
