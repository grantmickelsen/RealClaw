import { View, Text, StyleSheet } from 'react-native';
import { SignalChip } from './SignalChip';
import type { SmsMessage } from '../../store/sms';
import type { ExtractedSignals } from '../../store/sms';

interface Props {
  message: SmsMessage;
  showTimestamp: boolean;
  onSignalPress?: (signal: { label: string }) => void;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${m} ${ampm}`;
}

function StatusTick({ status }: { status: string }) {
  if (status === 'delivered') return <Text style={styles.tick}>✓✓</Text>;
  if (status === 'sent') return <Text style={styles.tick}>✓</Text>;
  if (status === 'failed' || status === 'undelivered') return <Text style={[styles.tick, { color: '#EF4444' }]}>!</Text>;
  return null;
}

export function SmsBubble({ message, showTimestamp, onSignalPress }: Props) {
  const isOut = message.direction === 'outbound';

  return (
    <View style={styles.wrapper}>
      {showTimestamp && (
        <Text style={styles.timestamp}>{formatTime(message.createdAt)}</Text>
      )}
      <View style={[styles.row, isOut && styles.rowOut]}>
        {!isOut && <View style={styles.avatar} />}
        <View style={[styles.bubble, isOut ? styles.bubbleOut : styles.bubbleIn]}>
          <Text style={[styles.body, isOut && styles.bodyOut]}>{message.body}</Text>
          {isOut && <StatusTick status={message.status} />}
        </View>
      </View>
      {!isOut && message.extractedSignals && (
        <SignalChip
          signals={message.extractedSignals}
          onPress={onSignalPress}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginVertical: 2, paddingHorizontal: 12 },
  timestamp: { textAlign: 'center', fontSize: 11, color: '#9CA3AF', marginVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  rowOut: { justifyContent: 'flex-end' },
  avatar: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#E5E7EB', flexShrink: 0,
  },
  bubble: {
    maxWidth: '75%', paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 18,
  },
  bubbleIn: { backgroundColor: '#F3F4F6', borderBottomLeftRadius: 4 },
  bubbleOut: { backgroundColor: '#6366F1', borderBottomRightRadius: 4 },
  body: { fontSize: 15, color: '#111827', lineHeight: 20 },
  bodyOut: { color: '#FFFFFF' },
  tick: { fontSize: 10, color: 'rgba(255,255,255,0.7)', alignSelf: 'flex-end', marginTop: 2 },
});
