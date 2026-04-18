import { View, Text, StyleSheet, Pressable } from 'react-native';
import { router } from 'expo-router';
import type { ApprovalActionType } from '../../store/approvals';

interface Props {
  approvalId: string;
  description: string;
  onResolved: () => void;
}

const CATEGORY_LABELS: Record<ApprovalActionType | string, string> = {
  send_email: 'Email',
  send_sms: 'SMS',
  send_linkedin_dm: 'LinkedIn DM',
  modify_calendar: 'Calendar',
  post_social: 'Social Post',
  send_document: 'Document',
  financial_action: 'Financial',
};

const CATEGORY_ICONS: Record<ApprovalActionType | string, string> = {
  send_email: '📧',
  send_sms: '💬',
  send_linkedin_dm: '💼',
  modify_calendar: '📅',
  post_social: '📱',
  send_document: '📄',
  financial_action: '💰',
};

function extractCategories(description: string): string[] {
  const found: string[] = [];
  for (const key of Object.keys(CATEGORY_LABELS)) {
    if (description.toLowerCase().includes(key.replace('_', ' ')) || description.toLowerCase().includes(CATEGORY_LABELS[key].toLowerCase())) {
      found.push(key);
    }
  }
  return found.length > 0 ? found : ['send_email'];
}

export function ApprovalCard({ approvalId, description, onResolved }: Props) {
  void onResolved; // called by the carousel screen on completion

  const categories = extractCategories(description);

  function handlePress() {
    router.push(`/approval/${approvalId}`);
  }

  return (
    <Pressable style={styles.card} onPress={handlePress} accessibilityRole="button">
      <View style={styles.header}>
        <Text style={styles.bolt}>⚡</Text>
        <Text style={styles.title}>
          {categories.length === 1 ? '1 action needs' : `${categories.length} actions need`} your approval
        </Text>
      </View>

      <View style={styles.chips}>
        {categories.map(cat => (
          <View key={cat} style={styles.chip}>
            <Text style={styles.chipText}>
              {CATEGORY_ICONS[cat]} {CATEGORY_LABELS[cat]}
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.footer}>
        <Text style={styles.cta}>Review now →</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 12,
    marginVertical: 6,
    backgroundColor: '#fff8e6',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#ffcc00',
    padding: 14,
    gap: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  bolt: { fontSize: 16 },
  title: { fontSize: 14, fontWeight: '600', color: '#7a4f00', flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    backgroundColor: 'rgba(255,204,0,0.25)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  chipText: { fontSize: 12, color: '#7a4f00', fontWeight: '500' },
  footer: { alignItems: 'flex-end' },
  cta: { fontSize: 14, fontWeight: '700', color: '#0066FF' },
});
