import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRef, useCallback, useEffect } from 'react';

interface Props {
  contactName: string;
  onConfirm(): void;
  onCancel(): void;
}

export function OptInSheet({ contactName, onConfirm, onCancel }: Props) {
  const sheetRef = useRef<BottomSheet>(null);

  useEffect(() => {
    sheetRef.current?.expand();
  }, []);

  const handleSheetChange = useCallback((index: number) => {
    if (index === -1) onCancel();
  }, [onCancel]);

  return (
    <BottomSheet
      ref={sheetRef}
      index={0}
      snapPoints={['35%']}
      enablePanDownToClose
      onChange={handleSheetChange}
      backgroundStyle={styles.sheetBg}
      handleIndicatorStyle={styles.handle}
    >
      <BottomSheetView style={styles.content}>
        <Text style={styles.title}>Start a conversation?</Text>
        <Text style={styles.body}>
          Start a text conversation with{' '}
          <Text style={styles.bold}>{contactName}</Text>?
          {'\n\n'}By texting, you confirm they've consented to receive SMS from you.
        </Text>
        <View style={styles.actions}>
          <TouchableOpacity style={styles.cancelBtn} onPress={onCancel} activeOpacity={0.8}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.confirmBtn} onPress={onConfirm} activeOpacity={0.8}>
            <Text style={styles.confirmText}>Start Conversation</Text>
          </TouchableOpacity>
        </View>
      </BottomSheetView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheetBg: { backgroundColor: '#FFFFFF', borderRadius: 24 },
  handle: { backgroundColor: '#E5E7EB' },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 8, gap: 16 },
  title: { fontSize: 20, fontWeight: '700', color: '#111827' },
  body: { fontSize: 15, color: '#6B7280', lineHeight: 22 },
  bold: { fontWeight: '700', color: '#111827' },
  actions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  cancelBtn: {
    flex: 1, paddingVertical: 14, borderRadius: 14,
    backgroundColor: '#F3F4F6', alignItems: 'center',
  },
  cancelText: { fontSize: 15, fontWeight: '600', color: '#6B7280' },
  confirmBtn: {
    flex: 2, paddingVertical: 14, borderRadius: 14,
    backgroundColor: '#6366F1', alignItems: 'center',
  },
  confirmText: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
});
