import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, FlatList, TextInput, TouchableOpacity, Text,
  StyleSheet, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSmsStore, type SmsMessage, EMPTY_MESSAGES, EMPTY_SUGGESTIONS } from '../../../store/sms';
import { useContactsStore } from '../../../store/contacts';
import { authedFetch } from '../../../lib/api';
import { ThreadHeader } from '../../../components/sms/ThreadHeader';
import { SmsBubble } from '../../../components/sms/SmsBubble';
import { SuggestionBar } from '../../../components/sms/SuggestionBar';
import { OptInSheet } from '../../../components/sms/OptInSheet';

export default function ThreadScreen() {
  const { contactId, draft } = useLocalSearchParams<{ contactId: string; draft?: string }>();
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [showOptIn, setShowOptIn] = useState(false);
  const [pendingOptIn, setPendingOptIn] = useState(false);
  const flatRef = useRef<FlatList<SmsMessage>>(null);

  const messages = useSmsStore(s => s.threads[contactId] ?? EMPTY_MESSAGES);
  const suggestions = useSmsStore(s => s.suggestions[contactId] ?? EMPTY_SUGGESTIONS);
  const suggestionsLoading = useSmsStore(s => s.suggestionsLoading[contactId] ?? false);
  const { setThread, appendMessage, setSuggestions, setSuggestionsLoading, markRead } = useSmsStore();

  const contact = useContactsStore(s => s.contacts.find(c => c.id === contactId));

  useEffect(() => {
    void loadThread();
    void loadSuggestions();
    markRead(contactId);
    if (draft) setInputText(decodeURIComponent(draft));
  }, [contactId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadThread() {
    try {
      const res = await authedFetch(`/v1/sms/${encodeURIComponent(contactId)}`);
      if (res.ok) {
        const data = await res.json() as { messages: SmsMessage[] };
        setThread(contactId, data.messages);
      }
    } catch { /* ignore */ }
  }

  async function loadSuggestions(regenerate = false) {
    setSuggestionsLoading(contactId, true);
    if (regenerate) setSuggestions(contactId, []);
    try {
      const recent = messages.slice(-5).map(m =>
        `${m.direction === 'inbound' ? 'Contact' : 'Agent'}: ${m.body}`
      ).join('\n');
      const profileParts = [
        contact?.name && `Name: ${contact.name}`,
        contact?.stage && `Stage: ${contact.stage}`,
        contact?.budget && `Budget: ${contact.budget}`,
        contact?.phone && `Phone: ${contact.phone}`,
      ].filter(Boolean).join(', ');

      const res = await authedFetch('/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `sms_suggest for contact ${contactId}`,
          channelId: `sms-suggest-${contactId}`,
          taskType: 'sms_suggest',
          data: {
            contactId,
            contactProfile: profileParts,
            recentMessages: recent,
            previousSuggestions: regenerate ? (suggestions ?? []).join('\n') : '',
          },
        }),
      });
      if (res.ok) {
        const data = await res.json() as { suggestions?: string[] };
        if (data.suggestions) setSuggestions(contactId, data.suggestions);
        else setSuggestionsLoading(contactId, false);
      } else {
        setSuggestionsLoading(contactId, false);
      }
    } catch {
      setSuggestionsLoading(contactId, false);
    }
  }

  async function handleOptInConfirm() {
    setShowOptIn(false);
    setPendingOptIn(true);
    try {
      await authedFetch(`/v1/sms/${encodeURIComponent(contactId)}/opt-in`, { method: 'PATCH' });
    } catch { /* ignore */ }
    setPendingOptIn(false);
    void doSend(inputText);
  }

  async function doSend(text: string) {
    if (!text.trim() || sending) return;
    setSending(true);
    const body = text.trim();
    setInputText('');

    // Optimistic message
    const tempId = `temp-${Date.now()}`;
    appendMessage(contactId, {
      id: tempId, direction: 'outbound', body, status: 'sending',
      sentVia: 'agent', extractedSignals: null,
      createdAt: new Date().toISOString(), twilioSid: null,
    });

    setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);

    try {
      const res = await authedFetch('/v1/sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId, message: body }),
      });

      if (res.status === 403) {
        // Opted-out — show opt-in sheet
        setInputText(body);
        setShowOptIn(true);
        setSending(false);
        return;
      }

      if (!res.ok) {
        Alert.alert('Failed to send', 'Please try again.');
        setSending(false);
        return;
      }

      const data = await res.json() as { id: string; twilioSid: string | null };
      // Replace temp message with real one
      appendMessage(contactId, {
        id: data.id, direction: 'outbound', body, status: 'sent',
        sentVia: 'agent', extractedSignals: null,
        createdAt: new Date().toISOString(), twilioSid: data.twilioSid,
      });
    } catch {
      Alert.alert('Failed to send', 'Check your connection and try again.');
    }
    setSending(false);
  }

  function handleSend() {
    void doSend(inputText);
  }

  function shouldShowTimestamp(index: number): boolean {
    if (index === 0) return true;
    const prev = messages[index - 1];
    const curr = messages[index];
    if (!prev || !curr) return false;
    return new Date(curr.createdAt).getTime() - new Date(prev.createdAt).getTime() > 60 * 60 * 1000;
  }

  const charCount = inputText.length;

  return (
    <View style={styles.container}>
      <ThreadHeader
        contactId={contactId}
        name={contact?.name ?? 'Unknown'}
        phone={contact?.phone ?? ''}
        temperatureScore={contact?.temperatureScore}
        stage={contact?.stage}
        budget={contact?.budget}
        timeline={contact?.timeline}
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <FlatList
          ref={flatRef}
          data={messages}
          keyExtractor={m => m.id}
          renderItem={({ item, index }) => (
            <SmsBubble
              message={item}
              showTimestamp={shouldShowTimestamp(index)}
            />
          )}
          contentContainerStyle={styles.messageList}
          onContentSizeChange={() => flatRef.current?.scrollToEnd({ animated: false })}
        />

        <SuggestionBar
          suggestions={suggestions}
          loading={suggestionsLoading}
          onSelect={text => setInputText(text)}
          onRegenerate={() => void loadSuggestions(true)}
        />

        <View style={styles.inputRow}>
          <TouchableOpacity style={styles.micBtn} activeOpacity={0.7}>
            <Ionicons name="mic-outline" size={20} color="#6B7280" />
          </TouchableOpacity>
          <View style={styles.inputWrap}>
            <TextInput
              style={styles.input}
              value={inputText}
              onChangeText={setInputText}
              placeholder="Type a message…"
              placeholderTextColor="#9CA3AF"
              multiline
              maxLength={1600}
              returnKeyType="default"
            />
            {charCount >= 140 && (
              <Text style={styles.charCount}>{charCount}</Text>
            )}
          </View>
          <TouchableOpacity
            style={[styles.sendBtn, (!inputText.trim() || sending) && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!inputText.trim() || sending}
            activeOpacity={0.8}
          >
            <Ionicons name="arrow-up" size={18} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {showOptIn && contact && (
        <OptInSheet
          contactName={contact.name ?? 'this contact'}
          onConfirm={() => void handleOptInConfirm()}
          onCancel={() => { setShowOptIn(false); setInputText(''); }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  flex: { flex: 1 },
  messageList: { paddingVertical: 12 },
  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: '#F3F4F6',
    backgroundColor: '#FFFFFF',
  },
  micBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, alignSelf: 'flex-end',
  },
  inputWrap: {
    flex: 1, backgroundColor: '#F9FAFB', borderRadius: 20,
    borderWidth: 1, borderColor: '#E5E7EB',
    paddingHorizontal: 14, paddingVertical: 8, minHeight: 36,
    justifyContent: 'center',
  },
  input: { fontSize: 15, color: '#111827', maxHeight: 120, lineHeight: 20 },
  charCount: { fontSize: 10, color: '#9CA3AF', textAlign: 'right', marginTop: 2 },
  sendBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#6366F1', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, alignSelf: 'flex-end',
  },
  sendBtnDisabled: { backgroundColor: '#C7D2FE' },
});
