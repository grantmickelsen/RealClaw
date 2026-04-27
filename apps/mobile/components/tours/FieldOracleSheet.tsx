import { useRef, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';
import { useToursStore } from '../../store/tours';

const SNAP_POINTS = ['50%', '92%'];

interface Props {
  address: string;
}

export function FieldOracleSheet({ address }: Props) {
  const sheetRef = useRef<BottomSheet>(null);
  const content = useToursStore((s) => s.fieldOracleContent);
  const loading = useToursStore((s) => s.fieldOracleLoading);

  const handleAnimate = useCallback(() => {
    sheetRef.current?.snapToIndex(0);
  }, []);

  return (
    <>
      {/* Collapsed chip — always visible */}
      <View style={styles.chipWrapper}>
        <Text style={styles.chip} onPress={handleAnimate}>
          Research Dossier ↑
        </Text>
      </View>

      <BottomSheet
        ref={sheetRef}
        index={-1}
        snapPoints={SNAP_POINTS}
        enablePanDownToClose
        backgroundStyle={styles.sheetBg}
        handleIndicatorStyle={styles.handle}
      >
        <BottomSheetView style={styles.content}>
          <Text style={styles.header}>
            Field Oracle{' '}
            <Text style={styles.headerAddr} numberOfLines={1}>{address}</Text>
          </Text>

          {loading && !content && (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color="#0066FF" />
              <Text style={styles.loadingText}>Researching property…</Text>
            </View>
          )}

          {!loading && !content && (
            <Text style={styles.emptyText}>
              Tap "I've Arrived" to load the property dossier.
            </Text>
          )}

          {content && (
            <ScrollView showsVerticalScrollIndicator={false} style={styles.scroll}>
              <Text style={styles.oracleText}>{content}</Text>
              {loading && <ActivityIndicator size="small" color="#0066FF" style={{ marginTop: 8 }} />}
            </ScrollView>
          )}
        </BottomSheetView>
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  chipWrapper: {
    alignItems: 'center',
    marginTop: 8,
  },
  chip: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0066FF',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    overflow: 'hidden',
  },
  sheetBg: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 16,
  },
  handle: {
    backgroundColor: '#D1D5DB',
    width: 36,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 40,
  },
  header: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 14,
  },
  headerAddr: {
    fontWeight: '400',
    color: '#6B7280',
    fontSize: 13,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
  },
  loadingText: {
    fontSize: 14,
    color: '#6B7280',
  },
  emptyText: {
    fontSize: 14,
    color: '#9CA3AF',
    lineHeight: 22,
    marginTop: 8,
  },
  scroll: { flex: 1 },
  oracleText: {
    fontSize: 15,
    color: '#1a1a1a',
    lineHeight: 24,
  },
});
