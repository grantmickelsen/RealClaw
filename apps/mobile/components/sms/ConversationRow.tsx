import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import type { SmsConversation } from '../../store/sms';

const TEMP_RING: Record<string, string> = {
  hot: '#EF4444', warm: '#F97316', cold: '#3B82F6',
};

function tempColor(signals: SmsConversation['latestSignals']): string {
  const urgency = signals?.urgencyLevel ?? 'low';
  if (urgency === 'critical' || urgency === 'high') return TEMP_RING.hot;
  if (urgency === 'medium') return TEMP_RING.warm;
  return TEMP_RING.cold;
}

function initials(name: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function signalTags(conv: SmsConversation): string[] {
  const s = conv.latestSignals;
  if (!s) return [];
  const tags: string[] = [];
  if (s.budget?.value) tags.push(`💰 ${s.budget.value}`);
  if (s.timeline?.value) tags.push(`⏰ ${s.timeline.value}`);
  if (s.preferences?.[0]) tags.push(`✨ ${s.preferences[0]}`);
  if (s.objections?.[0]) tags.push(`⚠️ ${s.objections[0]}`);
  return tags.slice(0, 2);
}

interface Props {
  conversation: SmsConversation;
  onPress(): void;
}

export function ConversationRow({ conversation: conv, onPress }: Props) {
  const unread = conv.unreadCount > 0;
  const ringColor = tempColor(conv.latestSignals);
  const tags = signalTags(conv);
  const displayName = conv.contactName ?? conv.phone ?? 'Unknown';

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={[styles.avatarRing, { borderColor: ringColor }]}>
        <View style={[styles.avatar, { backgroundColor: ringColor + '20' }]}>
          <Text style={[styles.initials, { color: ringColor }]}>{initials(conv.contactName)}</Text>
        </View>
        {unread && (
          <View style={styles.unreadBadge}>
            <Text style={styles.unreadCount}>{conv.unreadCount > 9 ? '9+' : conv.unreadCount}</Text>
          </View>
        )}
      </View>
      <View style={styles.content}>
        <View style={styles.topLine}>
          <Text style={[styles.name, unread && styles.nameUnread]} numberOfLines={1}>
            {displayName}
          </Text>
          <Text style={styles.time}>{relativeTime(conv.lastMessageAt)}</Text>
        </View>
        <Text style={[styles.preview, unread && styles.previewUnread]} numberOfLines={1}>
          {conv.lastDirection === 'outbound' ? 'You: ' : ''}{conv.lastMessage}
        </Text>
        {tags.length > 0 && (
          <View style={styles.tagsRow}>
            {tags.map((tag, i) => (
              <View key={i} style={styles.tag}>
                <Text style={styles.tagText}>{tag}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: '#FFFFFF',
  },
  avatarRing: {
    width: 50, height: 50, borderRadius: 25,
    borderWidth: 2, padding: 2, flexShrink: 0,
  },
  avatar: {
    flex: 1, borderRadius: 23,
    alignItems: 'center', justifyContent: 'center',
  },
  initials: { fontSize: 16, fontWeight: '700' },
  unreadBadge: {
    position: 'absolute', top: -2, right: -2,
    backgroundColor: '#6366F1', borderRadius: 10,
    minWidth: 18, height: 18,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 4,
  },
  unreadCount: { fontSize: 10, fontWeight: '700', color: '#FFFFFF' },
  content: { flex: 1, gap: 2 },
  topLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: 15, color: '#374151', flex: 1 },
  nameUnread: { fontWeight: '700', color: '#111827' },
  time: { fontSize: 12, color: '#9CA3AF' },
  preview: { fontSize: 13, color: '#9CA3AF', lineHeight: 18 },
  previewUnread: { color: '#374151', fontWeight: '500' },
  tagsRow: { flexDirection: 'row', gap: 6, marginTop: 4 },
  tag: { backgroundColor: '#F3F4F6', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  tagText: { fontSize: 11, color: '#6B7280' },
});
