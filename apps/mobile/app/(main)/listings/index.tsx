import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, RefreshControl,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { authedFetch } from '../../../lib/api';

interface Listing {
  id: string;
  address: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  status: 'active' | 'pending' | 'sold' | 'archived';
  price: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
}

const STATUS_COLORS: Record<Listing['status'], string> = {
  active:   '#16A34A',
  pending:  '#D97706',
  sold:     '#6B7280',
  archived: '#9CA3AF',
};

function formatPrice(p: number | null): string {
  if (!p) return '';
  if (p >= 1_000_000) return `$${(p / 1_000_000).toFixed(1)}M`;
  if (p >= 1_000) return `$${(p / 1_000).toFixed(0)}K`;
  return `$${p}`;
}

export default function ListingsScreen() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [addAddress, setAddAddress] = useState('');
  const [addSheetVisible, setAddSheetVisible] = useState(false);
  const [adding, setAdding] = useState(false);

  const fetchListings = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await authedFetch('/v1/listings');
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json() as Listing[];
      setListings(data);
    } catch {
      if (!silent) Alert.alert('Error', 'Could not load listings.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void fetchListings(); }, [fetchListings]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    void fetchListings(true);
  }, [fetchListings]);

  const handleAdd = useCallback(async () => {
    const addr = addAddress.trim();
    if (!addr) return;
    setAdding(true);
    try {
      // Try RentCast lookup first to pre-fill
      const lookupRes = await authedFetch('/v1/listings/rentcast-lookup', {
        method: 'POST',
        body: JSON.stringify({ address: addr }),
      });
      let prefill: Record<string, unknown> = {};
      if (lookupRes.ok) {
        prefill = await lookupRes.json() as Record<string, unknown>;
      }
      // Create a draft listing so we have an ID to navigate to
      const createRes = await authedFetch('/v1/listings', {
        method: 'POST',
        body: JSON.stringify({ address: addr, ...prefill }),
      });
      if (!createRes.ok) throw new Error('Could not create listing');
      const created = await createRes.json() as { id: string };
      setAddSheetVisible(false);
      setAddAddress('');
      router.push(`/(main)/listings/${created.id}`);
    } catch {
      Alert.alert('Error', 'Could not create listing. Check the address and try again.');
    } finally {
      setAdding(false);
    }
  }, [addAddress]);

  const renderItem = useCallback(({ item }: { item: Listing }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push(`/(main)/listings/${item.id}`)}
      activeOpacity={0.75}
    >
      <View style={styles.cardTop}>
        <Text style={styles.cardAddress} numberOfLines={1}>{item.address}</Text>
        <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[item.status] + '22' }]}>
          <Text style={[styles.statusText, { color: STATUS_COLORS[item.status] }]}>
            {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
          </Text>
        </View>
      </View>
      <Text style={styles.cardCity} numberOfLines={1}>
        {[item.city, item.state, item.zip].filter(Boolean).join(', ')}
      </Text>
      <View style={styles.cardMeta}>
        {item.price ? <Text style={styles.metaPrice}>{formatPrice(item.price)}</Text> : null}
        {(item.beds || item.baths) ? (
          <Text style={styles.metaDetail}>
            {item.beds ? `${item.beds}bd` : ''}{item.beds && item.baths ? ' · ' : ''}{item.baths ? `${item.baths}ba` : ''}
          </Text>
        ) : null}
        {item.sqft ? <Text style={styles.metaDetail}>{item.sqft.toLocaleString()} sqft</Text> : null}
      </View>
    </TouchableOpacity>
  ), []);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>My Listings</Text>
        <TouchableOpacity style={styles.addBtn} onPress={() => setAddSheetVisible(true)}>
          <Text style={styles.addBtnText}>+</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} size="large" color="#0066FF" />
      ) : (
        <FlatList
          data={listings}
          keyExtractor={i => i.id}
          renderItem={renderItem}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
          contentContainerStyle={listings.length === 0 ? styles.emptyContainer : styles.list}
          ListEmptyComponent={(
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No listings yet</Text>
              <Text style={styles.emptyHint}>Tap + to add your first property card.</Text>
            </View>
          )}
        />
      )}

      {/* Add sheet */}
      {addSheetVisible && (
        <View style={styles.sheet}>
          <View style={styles.sheetInner}>
            <Text style={styles.sheetTitle}>Add Property</Text>
            <TextInput
              style={styles.sheetInput}
              value={addAddress}
              onChangeText={setAddAddress}
              placeholder="123 Main St, Santa Barbara, CA"
              placeholderTextColor="#9CA3AF"
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() => void handleAdd()}
            />
            <View style={styles.sheetButtons}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => { setAddSheetVisible(false); setAddAddress(''); }}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmBtn, (!addAddress.trim() || adding) && styles.btnDisabled]}
                onPress={() => void handleAdd()}
                disabled={!addAddress.trim() || adding}
              >
                {adding ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.confirmBtnText}>Import & Create →</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f2f2f7' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
  },
  backBtn: { minWidth: 60 },
  backText: { fontSize: 17, color: '#0066FF' },
  title: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: '#1a1a1a' },
  addBtn: { minWidth: 60, alignItems: 'flex-end' },
  addBtnText: { fontSize: 28, color: '#0066FF', fontWeight: '400', lineHeight: 32 },

  list: { padding: 16, gap: 12 },
  emptyContainer: { flex: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#1a1a1a' },
  emptyHint: { fontSize: 15, color: '#6B7280' },

  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    gap: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07,
    shadowRadius: 4,
    elevation: 2,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardAddress: { flex: 1, fontSize: 16, fontWeight: '600', color: '#1a1a1a' },
  statusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { fontSize: 12, fontWeight: '700' },
  cardCity: { fontSize: 14, color: '#6B7280' },
  cardMeta: { flexDirection: 'row', gap: 12, marginTop: 4, flexWrap: 'wrap' },
  metaPrice: { fontSize: 15, fontWeight: '700', color: '#1a1a1a' },
  metaDetail: { fontSize: 14, color: '#6B7280' },

  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
    top: 0,
    justifyContent: 'flex-end',
  },
  sheetInner: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    gap: 16,
  },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: '#1a1a1a' },
  sheetInput: {
    backgroundColor: '#f2f2f7',
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  sheetButtons: { flexDirection: 'row', gap: 12 },
  cancelBtn: {
    flex: 1,
    backgroundColor: '#f2f2f7',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  cancelBtnText: { fontSize: 16, color: '#1a1a1a', fontWeight: '600' },
  confirmBtn: {
    flex: 2,
    backgroundColor: '#0066FF',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  confirmBtnText: { fontSize: 16, color: '#fff', fontWeight: '700' },
  btnDisabled: { opacity: 0.5 },
});
