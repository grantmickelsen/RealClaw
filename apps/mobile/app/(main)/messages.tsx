import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useSmsStore, type SmsConversation } from '../../store/sms';
import { ConversationRow } from '../../components/sms/ConversationRow';
import { RealClawRow } from '../../components/sms/RealClawRow';
import { authedFetch } from '../../lib/api';

type Segment = 'all' | 'unread' | 'flagged';

export default function MessagesScreen() {
  const [loading, setLoading] = useState(false);
  const [segment, setSegment] = useState<Segment>('all');

  const conversations = useSmsStore(s => s.conversations);
  const setConversations = useSmsStore(s => s.setConversations);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authedFetch('/v1/sms');
      if (res.ok) {
        const data = await res.json() as { conversations: SmsConversation[] };
        setConversations(data.conversations);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [setConversations]);

  useEffect(() => { void load(); }, [load]);

  const filtered = conversations.filter(c => {
    if (segment === 'unread') return c.unreadCount > 0;
    if (segment === 'flagged') {
      const u = c.latestSignals?.urgencyLevel;
      return u === 'high' || u === 'critical' || (c.latestSignals?.competitorMentions?.length ?? 0) > 0;
    }
    return true;
  });

  const unreadTotal = conversations.reduce((n, c) => n + c.unreadCount, 0);

  function handlePress(conv: SmsConversation) {
    if (!conv.contactId) return;
    router.push(`/(main)/sms/${encodeURIComponent(conv.contactId)}`);
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>
          Messages{unreadTotal > 0 ? ` (${unreadTotal})` : ''}
        </Text>
        <TouchableOpacity style={styles.composeBtn} activeOpacity={0.7} onPress={() => {}}>
          <Text style={styles.composeIcon}>✏️</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.segments}>
        {(['all', 'unread', 'flagged'] as Segment[]).map(seg => (
          <TouchableOpacity
            key={seg}
            style={[styles.seg, segment === seg && styles.segActive]}
            onPress={() => setSegment(seg)}
            activeOpacity={0.8}
          >
            <Text style={[styles.segText, segment === seg && styles.segTextActive]}>
              {seg === 'all' ? 'All' : seg === 'unread' ? 'Unread' : 'AI Flagged'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* RealClaw pinned at top — always visible regardless of segment */}
      <RealClawRow onPress={() => router.push('/(main)/sms/realclaw')} />
      <View style={styles.divider} />

      {loading && conversations.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color="#6366F1" />
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>💬</Text>
          <Text style={styles.emptyTitle}>
            {segment === 'all' ? 'No contact messages yet' : 'Nothing here'}
          </Text>
          <Text style={styles.emptyBody}>
            {segment === 'unread'
              ? 'All caught up!'
              : segment === 'flagged'
                ? 'No high-urgency signals detected'
                : 'Conversations with your contacts will appear here'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={c => c.contactId ?? c.phone ?? Math.random().toString()}
          renderItem={({ item }) => (
            <ConversationRow
              conversation={item}
              onPress={() => handlePress(item)}
            />
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          onRefresh={load}
          refreshing={loading}
          contentContainerStyle={styles.list}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
  },
  title: { fontSize: 28, fontWeight: '800', color: '#111827' },
  composeBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  composeIcon: { fontSize: 20 },
  segments: {
    flexDirection: 'row', gap: 8,
    paddingHorizontal: 16, paddingBottom: 12,
  },
  seg: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    backgroundColor: '#F3F4F6',
  },
  segActive: { backgroundColor: '#EEF2FF' },
  segText: { fontSize: 13, fontWeight: '500', color: '#6B7280' },
  segTextActive: { color: '#4338CA', fontWeight: '700' },
  list: { paddingBottom: 120 },
  divider: { height: 1, backgroundColor: '#E5E7EB' },
  separator: { height: 1, backgroundColor: '#F9FAFB', marginLeft: 78 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 40 },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#111827' },
  emptyBody: { fontSize: 14, color: '#9CA3AF', textAlign: 'center', lineHeight: 20 },
});
