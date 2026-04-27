import { forwardRef, useState, useCallback, useRef, useEffect, useImperativeHandle } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Text,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { v4 as uuidv4 } from 'uuid';
import { useChatStore } from '../store/chat';
import { useWsStore } from '../store/ws';
import { MessageList } from './chat/MessageList';
import { SkillPicker } from './chat/SkillPicker';
import { VoiceInput } from './VoiceInput';
import { authedFetch } from '../lib/api';
import { saveMessage, loadRecentMessages, enqueueMessage } from '../lib/db';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { drainOfflineQueue } from '../lib/offline-queue';
import type { Skill } from '../constants/skills';

const SNAP_POINTS = ['90%'];
const TAB_BAR_BASE = 49;

export const ChatSheet = forwardRef<BottomSheet>((_, ref) => {
  const sheetRef = useRef<BottomSheet>(null);
  useImperativeHandle(ref, () => sheetRef.current!);

  const insets = useSafeAreaInsets();
  const tabBarHeight = TAB_BAR_BASE + insets.bottom;

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

  const handleClose = useCallback(() => {
    sheetRef.current?.close();
  }, []);

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
    await saveMessage({ ...userMsg, correlation_id: correlationId, role: 'user', agent_id: null, has_approval: 0, approval_id: null, synced: 0 });

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
    <BottomSheet
      ref={sheetRef}
      index={-1}
      snapPoints={SNAP_POINTS}
      enablePanDownToClose
      detached
      bottomInset={tabBarHeight}
      style={styles.sheet}
      backgroundStyle={styles.sheetBackground}
      handleIndicatorStyle={styles.handleIndicator}
    >
      <BottomSheetView style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerLeft} />
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>Ask Claw</Text>
            <View style={[styles.statusDot, { backgroundColor: wsStatus === 'connected' ? '#34c759' : '#ff9500' }]} />
          </View>
          <TouchableOpacity style={styles.headerRight} onPress={handleClose} hitSlop={12}>
            <Text style={styles.closeText}>Done</Text>
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
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
      </BottomSheetView>
    </BottomSheet>
  );
});

ChatSheet.displayName = 'ChatSheet';

const styles = StyleSheet.create({
  sheet: { marginHorizontal: 0 },
  sheetBackground: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  handleIndicator: { backgroundColor: '#d0d0d5', width: 40 },
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
  },
  headerLeft: { flex: 1 },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  headerRight: { flex: 1, alignItems: 'flex-end' },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#0066FF' },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  closeText: { fontSize: 16, fontWeight: '600', color: '#0066FF' },
  flex: { flex: 1 },
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
