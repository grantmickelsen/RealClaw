import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, ActivityIndicator, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { authedFetch } from '../../lib/api';
import { useBriefingStore, type BriefingItem } from '../../store/briefing';
import { ActionCard } from '../../components/briefing/ActionCard';
import { TrialBanner } from '../../components/paywall/TrialBanner';

export default function BriefingScreen() {
  const items = useBriefingStore(s => s.items);
  const loading = useBriefingStore(s => s.loading);
  const setItems = useBriefingStore(s => s.setItems);
  const pendingApprovalIds = useBriefingStore(s => s.pendingApprovalIds);
  const shiftPendingApproval = useBriefingStore(s => s.shiftPendingApproval);
  const clearPendingApprovals = useBriefingStore(s => s.clearPendingApprovals);
  const [regenerating, setRegenerating] = useState(false);
  const prevItemsLengthRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await authedFetch('/v1/briefing');
      if (res.ok) {
        const data = await res.json() as { items: Array<{
          id: string; type: BriefingItem['type']; urgencyScore: number;
          summaryText: string; draftContent: string | null;
          draftMedium: string | null; suggestedAction: string | null;
          contactId: string | null; createdAt: string;
        }> };
        setItems(data.items.map(i => ({
          id: i.id,
          type: i.type,
          urgencyScore: i.urgencyScore,
          summaryText: i.summaryText,
          draftContent: i.draftContent,
          draftMedium: i.draftMedium as BriefingItem['draftMedium'],
          suggestedAction: i.suggestedAction,
          contactId: i.contactId,
          createdAt: i.createdAt,
        })));
      }
    } catch { /* show stale */ }
  }, [setItems]);

  const regenerate = useCallback(async () => {
    setRegenerating(true);
    try {
      await authedFetch('/v1/briefing/regenerate', { method: 'POST' });
      // Wait briefly for generation then re-fetch
      await new Promise(r => setTimeout(r, 3000));
      await load();
    } catch { /* ignore */ } finally {
      setRegenerating(false);
    }
  }, [load]);

  useEffect(() => { void load(); }, [load]);

  // When the last briefing item is processed and approvals are queued, auto-launch carousel
  useEffect(() => {
    if (prevItemsLengthRef.current !== null && prevItemsLengthRef.current > 0 && items.length === 0 && pendingApprovalIds.length > 0) {
      const firstId = pendingApprovalIds[0];
      shiftPendingApproval();
      setTimeout(() => router.push(`/approval/${firstId}`), 400);
    }
    prevItemsLengthRef.current = items.length;
  }, [items.length]); // eslint-disable-line react-hooks/exhaustive-deps

  function launchCarousel() {
    if (pendingApprovalIds.length === 0) return;
    const firstId = pendingApprovalIds[0];
    shiftPendingApproval();
    router.push(`/approval/${firstId}`);
  }

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Daily Briefing</Text>
          <Text style={styles.date}>{today}</Text>
        </View>
        <View style={styles.headerActions}>
          {regenerating
            ? <ActivityIndicator size="small" color="#0066FF" style={styles.regenIcon} />
            : (
              <TouchableOpacity onPress={regenerate} hitSlop={12} accessibilityLabel="Regenerate briefing">
                <Ionicons name="refresh-outline" size={22} color="#0066FF" />
              </TouchableOpacity>
            )
          }
          <TouchableOpacity
            onPress={launchCarousel}
            hitSlop={12}
            accessibilityLabel={pendingApprovalIds.length > 0 ? `Review ${pendingApprovalIds.length} pending approval${pendingApprovalIds.length > 1 ? 's' : ''}` : 'No pending approvals'}
            disabled={pendingApprovalIds.length === 0}
          >
            <View style={styles.approvalBadgeWrap}>
              <Ionicons
                name="checkmark-circle-outline"
                size={24}
                color={pendingApprovalIds.length > 0 ? '#0066FF' : '#C7D2FE'}
              />
              {pendingApprovalIds.length > 0 && (
                <View style={styles.approvalBadge}>
                  <Text style={styles.approvalBadgeText}>{pendingApprovalIds.length}</Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/(main)/settings')} hitSlop={12} accessibilityLabel="Settings">
            <Ionicons name="settings-outline" size={24} color="#8e8e93" />
          </TouchableOpacity>
        </View>
      </View>

      <TrialBanner />

      {loading && items.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#0066FF" />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={i => i.id}
          renderItem={({ item }) => <ActionCard item={item} />}
          contentContainerStyle={items.length === 0 ? styles.emptyContainer : styles.listContent}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={load} tintColor="#0066FF" />
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>✓</Text>
              <Text style={styles.emptyTitle}>You're all caught up.</Text>
              <Text style={styles.emptySubtitle}>
                New briefing items arrive each morning.{'\n'}Pull to refresh.
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f2f2f7' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
  },
  title: { fontSize: 28, fontWeight: '700', color: '#1a1a1a' },
  date: { fontSize: 14, color: '#888', marginTop: 2 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  regenIcon: { width: 22 },
  approvalBadgeWrap: { position: 'relative' },
  approvalBadge: {
    position: 'absolute', top: -4, right: -4,
    minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: '#EF4444', alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 3,
  },
  approvalBadgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingTop: 10, paddingBottom: 120 },
  emptyContainer: { flexGrow: 1 },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    paddingTop: 80,
  },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyTitle: { fontSize: 22, fontWeight: '700', color: '#1a1a1a', textAlign: 'center' },
  emptySubtitle: { fontSize: 15, color: '#888', textAlign: 'center', lineHeight: 22, marginTop: 8 },
});
