import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function ContactsScreen() {
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Contacts</Text>
      </View>
      <View style={styles.placeholder}>
        <Text style={styles.placeholderText}>
          Contact management coming in Phase 5.{'\n'}
          Ask Claw to look up contacts in the chat.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: {
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
  },
  title: { fontSize: 28, fontWeight: '700', color: '#1a1a1a' },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  placeholderText: { fontSize: 15, color: '#888', textAlign: 'center', lineHeight: 24 },
});
