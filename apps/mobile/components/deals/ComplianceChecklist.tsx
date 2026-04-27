import { View, Text, StyleSheet, TouchableOpacity, Alert, ActionSheetIOS, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { DealDocument, DocumentStatus } from '../../store/deals';

interface Props {
  documents: DealDocument[];
  onUpdateStatus(docId: string, status: DocumentStatus): void;
}

const STATUS_CONFIG: Record<DocumentStatus, { label: string; color: string; bg: string; icon: keyof typeof Ionicons.glyphMap }> = {
  required: { label: 'Required',  color: '#EF4444', bg: '#FEF2F2', icon: 'alert-circle-outline' },
  uploaded: { label: 'Uploaded',  color: '#F59E0B', bg: '#FFFBEB', icon: 'cloud-upload-outline' },
  signed:   { label: 'Signed',    color: '#10B981', bg: '#F0FDF4', icon: 'checkmark-circle' },
  waived:   { label: 'Waived',    color: '#9CA3AF', bg: '#F3F4F6', icon: 'remove-circle-outline' },
  n_a:      { label: 'N/A',       color: '#9CA3AF', bg: '#F3F4F6', icon: 'minus-circle-outline' },
};

const STATUS_OPTIONS: DocumentStatus[] = ['uploaded', 'signed', 'waived', 'n_a'];

function DocRow({ doc, onUpdateStatus }: { doc: DealDocument; onUpdateStatus: Props['onUpdateStatus'] }) {
  const cfg = STATUS_CONFIG[doc.status];

  const showPicker = () => {
    const labels = STATUS_OPTIONS.map(s => STATUS_CONFIG[s].label);
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { title: doc.name, options: [...labels, 'Cancel'], cancelButtonIndex: labels.length },
        i => { if (i < STATUS_OPTIONS.length) onUpdateStatus(doc.id, STATUS_OPTIONS[i]!); },
      );
    } else {
      Alert.alert(doc.name, 'Update status', [
        ...STATUS_OPTIONS.map(s => ({
          text: STATUS_CONFIG[s].label,
          onPress: () => onUpdateStatus(doc.id, s),
        })),
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  };

  return (
    <TouchableOpacity style={styles.docRow} onPress={showPicker} activeOpacity={0.7}>
      <Ionicons name={cfg.icon} size={20} color={cfg.color} style={{ marginRight: 10 }} />
      <View style={styles.docBody}>
        <Text style={styles.docName}>{doc.name}</Text>
        {doc.doc_type && (
          <Text style={styles.docType}>{doc.doc_type}</Text>
        )}
      </View>
      <View style={[styles.statusBadge, { backgroundColor: cfg.bg }]}>
        <Text style={[styles.statusText, { color: cfg.color }]}>{cfg.label}</Text>
      </View>
    </TouchableOpacity>
  );
}

export function ComplianceChecklist({ documents, onUpdateStatus }: Props) {
  const blocking    = documents.filter(d => d.is_blocking && d.status === 'required');
  const nonBlocking = documents.filter(d => !d.is_blocking || d.status !== 'required');

  const renderSection = (title: string, docs: DealDocument[], showWarning: boolean) => (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        {showWarning && <Ionicons name="alert-circle" size={14} color="#EF4444" style={{ marginRight: 4 }} />}
        <Text style={[styles.sectionTitle, showWarning && { color: '#EF4444' }]}>{title}</Text>
        {showWarning && (
          <View style={styles.countBadge}>
            <Text style={styles.countText}>{docs.length}</Text>
          </View>
        )}
      </View>
      {docs.map(doc => (
        <DocRow key={doc.id} doc={doc} onUpdateStatus={onUpdateStatus} />
      ))}
    </View>
  );

  if (!documents.length) {
    return (
      <View style={styles.empty}>
        <Ionicons name="shield-checkmark-outline" size={36} color="#10B981" />
        <Text style={styles.emptyText}>No disclosure documents required.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {blocking.length > 0 && renderSection('BLOCKING — Required Before Close', blocking, true)}
      {nonBlocking.length > 0 && renderSection('OTHER DOCUMENTS', nonBlocking, false)}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 16 },
  section: { marginBottom: 8 },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 8,
  },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: '#9CA3AF', letterSpacing: 0.8, flex: 1 },
  countBadge: {
    backgroundColor: '#EF4444', borderRadius: 10,
    minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  countText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  docRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 6,
    borderWidth: 1, borderColor: '#F3F4F6',
  },
  docBody: { flex: 1 },
  docName: { fontSize: 14, fontWeight: '600', color: '#111827' },
  docType: { fontSize: 11, color: '#9CA3AF', marginTop: 1 },
  statusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { fontSize: 12, fontWeight: '600' },
  empty: { alignItems: 'center', paddingTop: 40, paddingBottom: 20 },
  emptyText: { color: '#6B7280', fontSize: 14, marginTop: 8 },
});
