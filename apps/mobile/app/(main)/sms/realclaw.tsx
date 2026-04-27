import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, TextInput, TouchableOpacity, StyleSheet,
  Text, Platform, KeyboardAvoidingView,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { v4 as uuidv4 } from 'uuid';
import { Ionicons } from '@expo/vector-icons';
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

export default function RealClawScreen() {
  const insets = useSafeAreaInsets();
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [inputBarHeight, setInputBarHeight] = useState(64);
  const inputRef = useRef<TextInput>(null);

  const slashMatch = input.match(/^\/(\S*)$/);
  const pickerVisible = slashMatch !== null;
  const pickerQuery = slashMatch ? slashMatch[1]! : '';

  const handleSkillSelect = useCallback((skill: Skill) => {
    setInput(skill.template);
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
    await saveMessage({
      ...userMsg,
      correlation_id: correlationId,
      role: 'user',
      agent_id: null,
      has_approval: 0,
      approval_id: null,
      synced: 0,
    });

    const assistantId = uuidv4();
    addMessage({
      id: assistantId,
      correlationId,
      role: 'assistant' as const,
      text: '',
      status: 'sending' as const,
      timestamp: new Date().toISOString(),
    });

    setInput('');
    setSending(true);
    addPending(correlationId);

    if (!isConnected || wsStatus !== 'connected') {
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
        body: JSON.stringify({ platform: 'mobile', content: trimmed, correlationId }),
      });
      if (!res.ok) {
        updateMessage(correlationId, { status: 'error', text: 'Failed to send message' });
      }
    } catch {
      updateMessage(correlationId, { status: 'error', text: 'Network error' });
    } finally {
      setSending(false);
    }
  }, [sending, isConnected, wsStatus, addMessage, updateMessage, addPending]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color="#0066FF" />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <View style={styles.logoMark}>
            <Text style={styles.logoText}>RC</Text>
          </View>
          <Text style={styles.headerName}>RealClaw</Text>
          <View style={[styles.statusDot, {
            backgroundColor: wsStatus === 'connected' ? '#34c759' : '#ff9500',
          }]} />
        </View>

        <View style={styles.headerRight} />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
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
            placeholderTextColor="#9CA3AF"
            multiline
            maxLength={4000}
            returnKeyType="send"
            onSubmitEditing={() => { void sendMessage(input); }}
            editable={!sending}
          />

          <TouchableOpacity
            style={[styles.sendBtn, (!input.trim() || sending) && styles.sendBtnDisabled]}
            onPress={() => { void sendMessage(input); }}
            disabled={!input.trim() || sending}
            activeOpacity={0.8}
          >
            <Ionicons name="arrow-up" size={18} color="#FFFFFF" />
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  backBtn: { padding: 4, width: 44, alignItems: 'center' },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  logoMark: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#0066FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: { fontSize: 12, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.5 },
  headerName: { fontSize: 17, fontWeight: '700', color: '#111827' },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  headerRight: { width: 44 },
  flex: { flex: 1 },
  list: { flex: 1 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E7EB',
    gap: 8,
    backgroundColor: '#FFFFFF',
  },
  textInput: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    maxHeight: 120,
    color: '#111827',
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#0066FF',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    alignSelf: 'flex-end',
  },
  sendBtnDisabled: { backgroundColor: '#B0C8FF' },
});
