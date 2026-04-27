import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useChatStore } from '../../store/chat';
import { useWsStore } from '../../store/ws';

interface Props {
  onPress: () => void;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function RealClawRow({ onPress }: Props) {
  const messages = useChatStore(s => s.messages);
  const wsStatus = useWsStore(s => s.status);

  const lastMsg = messages[messages.length - 1];
  const preview = lastMsg
    ? (lastMsg.role === 'user' ? `You: ${lastMsg.text}` : lastMsg.text)
    : 'Your AI assistant — ask me anything';
  const timeLabel = lastMsg ? relativeTime(lastMsg.timestamp) : '';

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.75}>
      <View style={styles.avatarWrap}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>RC</Text>
        </View>
        <View style={[styles.statusDot, {
          backgroundColor: wsStatus === 'connected' ? '#34c759' : '#ff9500',
        }]} />
      </View>

      <View style={styles.body}>
        <View style={styles.topRow}>
          <Text style={styles.name}>RealClaw</Text>
          {timeLabel ? <Text style={styles.time}>{timeLabel}</Text> : null}
        </View>
        <Text style={styles.preview} numberOfLines={1}>{preview}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FAFBFF',
  },
  avatarWrap: { position: 'relative', marginRight: 14 },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 14,
    backgroundColor: '#0066FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 14, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.5 },
  statusDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  body: { flex: 1 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
  name: { fontSize: 16, fontWeight: '700', color: '#111827' },
  time: { fontSize: 12, color: '#9CA3AF' },
  preview: { fontSize: 14, color: '#6B7280', lineHeight: 19 },
});
