import { View, Text, StyleSheet } from 'react-native';
import type { ChatMessage } from '../../store/chat';

interface Props {
  message: ChatMessage;
}

export function MessageBubble({ message }: Props) {
  const isUser = message.role === 'user';

  return (
    <View style={[styles.row, isUser ? styles.userRow : styles.assistantRow]}>
      <View style={[styles.bubble, isUser ? styles.userBubble : styles.assistantBubble]}>
        {!isUser && message.agentId && (
          <Text style={styles.agentLabel}>{message.agentId}</Text>
        )}
        <Text style={[styles.text, isUser ? styles.userText : styles.assistantText]}>
          {message.text}
        </Text>
        <Text style={styles.timestamp}>
          {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: 12, paddingVertical: 4 },
  userRow: { alignItems: 'flex-end' },
  assistantRow: { alignItems: 'flex-start' },
  bubble: {
    maxWidth: '80%',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  userBubble: { backgroundColor: '#0066FF' },
  assistantBubble: { backgroundColor: '#f0f0f5' },
  agentLabel: { fontSize: 11, color: '#888', marginBottom: 2, fontWeight: '600' },
  text: { fontSize: 16, lineHeight: 22 },
  userText: { color: '#fff' },
  assistantText: { color: '#1a1a1a' },
  timestamp: { fontSize: 11, color: '#aaa', marginTop: 4, alignSelf: 'flex-end' },
});
