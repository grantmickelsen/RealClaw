import { useRef, useState, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { ChatMessage } from '../../store/chat';
import { useChatStore } from '../../store/chat';

interface Props {
  correlationId: string;
}

/**
 * StreamingBubble — renders a message whose text is still arriving via TOKEN_STREAM events.
 * Uses ref buffer + 80ms setInterval flush (Decision 5) to avoid per-token re-renders.
 */
export function StreamingBubble({ correlationId }: Props) {
  const storeText = useChatStore(s =>
    s.messages.find(m => m.correlationId === correlationId)?.text ?? '',
  );

  const buffer = useRef(storeText);
  const [displayed, setDisplayed] = useState(storeText);

  useEffect(() => {
    buffer.current = storeText;
  }, [storeText]);

  useEffect(() => {
    // Compare inside the callback so the interval is never restarted on flush
    const interval = setInterval(() => {
      setDisplayed(prev => (buffer.current !== prev ? buffer.current : prev));
    }, 80);
    return () => clearInterval(interval);
  }, []); // mount/unmount only

  return (
    <View style={styles.row}>
      <View style={styles.bubble}>
        <Text style={styles.text}>{displayed || '…'}</Text>
        <View style={styles.cursor} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: 12, paddingVertical: 4, alignItems: 'flex-start' },
  bubble: {
    maxWidth: '80%',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#f0f0f5',
  },
  text: { fontSize: 16, lineHeight: 22, color: '#1a1a1a' },
  cursor: {
    width: 8,
    height: 16,
    backgroundColor: '#0066FF',
    borderRadius: 2,
    marginTop: 2,
    opacity: 0.8,
  },
});
