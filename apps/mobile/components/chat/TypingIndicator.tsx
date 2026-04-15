import { View, Text, StyleSheet } from 'react-native';

export function TypingIndicator() {
  return (
    <View style={styles.container}>
      <View style={styles.bubble}>
        <Text style={styles.text}>Claw is thinking…</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 12, paddingVertical: 4, alignItems: 'flex-start' },
  bubble: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#f0f0f5',
  },
  text: { fontSize: 14, color: '#888', fontStyle: 'italic' },
});
