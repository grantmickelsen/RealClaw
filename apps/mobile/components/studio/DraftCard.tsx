import { View, Text, TextInput, StyleSheet } from 'react-native';
import { useStudioStore, type DraftField } from '../../store/studio';

const FIELD_LABELS: Record<DraftField, string> = {
  mlsDescription:   'MLS Description',
  instagramCaption: 'Instagram',
  facebookPost:     'Facebook',
  emailContent:     'Email',
  smsText:          'SMS',
};

const FIELD_ICONS: Record<DraftField, string> = {
  mlsDescription:   '🏠',
  instagramCaption: '📸',
  facebookPost:     '📘',
  emailContent:     '📧',
  smsText:          '💬',
};

interface Props {
  field: DraftField;
  value: string;
  complianceFlags: string[];
}

export function DraftCard({ field, value, complianceFlags }: Props) {
  const updateDraft = useStudioStore(s => s.updateDraft);
  const showCompliance = complianceFlags.length > 0 && field === 'mlsDescription';

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.icon}>{FIELD_ICONS[field]}</Text>
        <Text style={styles.label}>{FIELD_LABELS[field]}</Text>
      </View>

      {showCompliance && (
        <View style={styles.complianceBanner}>
          <Text style={styles.complianceIcon}>⚠️</Text>
          <Text style={styles.complianceText} numberOfLines={3}>
            {complianceFlags.join(' · ')}
          </Text>
        </View>
      )}

      <TextInput
        style={styles.editor}
        value={value}
        onChangeText={text => updateDraft(field, text)}
        multiline
        textAlignVertical="top"
        placeholderTextColor="#9CA3AF"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginVertical: 6,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 3,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  icon: { fontSize: 18 },
  label: { fontSize: 15, fontWeight: '700', color: '#1a1a1a' },
  complianceBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#FFF3CD',
    borderRadius: 10,
    padding: 10,
    gap: 8,
  },
  complianceIcon: { fontSize: 14 },
  complianceText: { flex: 1, fontSize: 12, color: '#856404', lineHeight: 18 },
  editor: {
    fontSize: 14,
    color: '#1a1a1a',
    lineHeight: 22,
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
    padding: 12,
    minHeight: 90,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
});
