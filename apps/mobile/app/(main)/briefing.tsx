import { useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { authedFetch } from '../../lib/api';
import { useBriefingStore, type BriefingItem } from '../../store/briefing';
import { ActionCard } from '../../components/briefing/ActionCard';
import { TrialBanner } from '../../components/paywall/TrialBanner';

export default function BriefingScreen() {
  const items = useBriefingStore(s => s.items);
  const loading = useBriefingStore(s => s.loading);
  const setItems = useBriefingStore(s => s.setItems);

  const load = useCallback(async () => {
    try {
      const res = await authedFetch('/v1/briefing');
      if (res.ok) {
        const data = await res.json() as { items: Array<{
          id: string; type: BriefingItem['type']; urgency_score: number;
          summary_text: string; draft_content: string | null;
          draft_medium: string | null; suggested_action: string | null;
          contact_id: string | null; created_at: string;
        }> };
        setItems(data.items.map(i => ({
          id: i.id,
          type: i.type,
          urgencyScore: i.urgency_score,
          summaryText: i.summary_text,
          draftContent: i.draft_content,
          draftMedium: i.draft_medium as BriefingItem['draftMedium'],
          suggestedAction: i.suggested_action,
          contactId: i.contact_id,
          createdAt: i.created_at,
        })));
      }
    } catch { /* show stale */ }
  }, [setItems]);

  useEffect(() => { void load(); }, [load]);

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Daily Briefing</Text>
        <Text style={styles.date}>{today}</Text>
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
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
  },
  title: { fontSize: 28, fontWeight: '700', color: '#1a1a1a' },
  date: { fontSize: 14, color: '#888', marginTop: 2 },
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
