import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal,
  FlatList, TextInput, ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { authedFetch } from '../../lib/api';
import { useStudioStore } from '../../store/studio';

interface Listing {
  id: string;
  address: string;
  city: string | null;
  state: string | null;
  status: 'active' | 'pending' | 'sold' | 'archived';
  price: number | null;
  beds: number | null;
  baths: number | null;
  features: string[];
  description: string | null;
}

export function PropertySelector() {
  const listingId      = useStudioStore(s => s.listingId);
  const listingAddress = useStudioStore(s => s.listingAddress);
  const setListing     = useStudioStore(s => s.setListing);

  const [modalVisible, setModalVisible] = useState(false);
  const [listings, setListings] = useState<Listing[]>([]);
  const [fetching, setFetching] = useState(false);
  const [search, setSearch] = useState('');
  const [manualAddress, setManualAddress] = useState('');
  const [showManual, setShowManual] = useState(false);

  const fetchListings = useCallback(async () => {
    setFetching(true);
    try {
      const res = await authedFetch('/v1/listings?status=active');
      if (res.ok) setListings(await res.json() as Listing[]);
    } catch { /* network error — list stays empty */ }
    finally { setFetching(false); }
  }, []);

  useEffect(() => {
    if (modalVisible) void fetchListings();
  }, [modalVisible, fetchListings]);

  const filtered = search.trim()
    ? listings.filter(l => l.address.toLowerCase().includes(search.toLowerCase()))
    : listings;

  const handleSelect = useCallback((l: Listing) => {
    const featureText = [
      ...(l.features ?? []),
      l.description ? l.description.slice(0, 200) : '',
    ].filter(Boolean).join(', ');
    const addressLabel = [l.address, l.city, l.state].filter(Boolean).join(', ');
    setListing(l.id, addressLabel, featureText);
    setModalVisible(false);
  }, [setListing]);

  const handleManualConfirm = useCallback(() => {
    const addr = manualAddress.trim();
    if (!addr) return;
    setListing(null, addr);
    setManualAddress('');
    setShowManual(false);
    setModalVisible(false);
  }, [manualAddress, setListing]);

  const handleClear = useCallback(() => {
    setListing(null, null);
  }, [setListing]);

  return (
    <>
      <TouchableOpacity style={styles.pill} onPress={() => setModalVisible(true)} activeOpacity={0.75}>
        <Text style={styles.pillIcon}>🏠</Text>
        {listingId || listingAddress ? (
          <>
            <View style={styles.pillContent}>
              <Text style={styles.pillAddress} numberOfLines={1}>{listingAddress ?? 'Selected listing'}</Text>
              {listingId && <Text style={styles.pillSub}>Saved listing</Text>}
            </View>
            <TouchableOpacity onPress={handleClear} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.clearBtn}>✕</Text>
            </TouchableOpacity>
          </>
        ) : (
          <Text style={styles.pillPlaceholder}>Select a property (optional) →</Text>
        )}
      </TouchableOpacity>

      <Modal
        visible={modalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setModalVisible(false)}
      >
        <SafeAreaView style={styles.modal} edges={['top']}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select Property</Text>
            <TouchableOpacity onPress={() => setModalVisible(false)}>
              <Text style={styles.modalClose}>Done</Text>
            </TouchableOpacity>
          </View>

          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search by address…"
            placeholderTextColor="#9CA3AF"
            clearButtonMode="while-editing"
          />

          {fetching ? (
            <ActivityIndicator style={{ marginTop: 32 }} color="#0066FF" />
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={i => i.id}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.listRow} onPress={() => handleSelect(item)}>
                  <View style={styles.listRowContent}>
                    <Text style={styles.listRowAddress} numberOfLines={1}>{item.address}</Text>
                    <Text style={styles.listRowMeta}>
                      {[
                        item.city,
                        item.beds ? `${item.beds}bd` : null,
                        item.baths ? `${item.baths}ba` : null,
                        item.price ? `$${(item.price / 1000).toFixed(0)}K` : null,
                      ].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <Text style={styles.listRowChevron}>›</Text>
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
              ListEmptyComponent={(
                <Text style={styles.emptyText}>No active listings found.</Text>
              )}
              ListFooterComponent={(
                <View style={styles.footer}>
                  {showManual ? (
                    <View style={styles.manualWrap}>
                      <TextInput
                        style={styles.manualInput}
                        value={manualAddress}
                        onChangeText={setManualAddress}
                        placeholder="Enter address manually…"
                        placeholderTextColor="#9CA3AF"
                        autoFocus
                        returnKeyType="done"
                        onSubmitEditing={handleManualConfirm}
                      />
                      <TouchableOpacity style={styles.manualConfirmBtn} onPress={handleManualConfirm}>
                        <Text style={styles.manualConfirmText}>Use this address</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity onPress={() => setShowManual(true)}>
                      <Text style={styles.manualLink}>Enter address manually →</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity onPress={() => { setModalVisible(false); router.push('/(main)/listings'); }}>
                    <Text style={styles.manageLink}>Manage Listings →</Text>
                  </TouchableOpacity>
                </View>
              )}
            />
          )}
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  pill: {
    marginHorizontal: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  pillIcon: { fontSize: 18 },
  pillPlaceholder: { flex: 1, fontSize: 15, color: '#9CA3AF' },
  pillContent: { flex: 1 },
  pillAddress: { fontSize: 15, color: '#1a1a1a', fontWeight: '500' },
  pillSub: { fontSize: 12, color: '#6B7280', marginTop: 1 },
  clearBtn: { fontSize: 16, color: '#9CA3AF' },

  modal: { flex: 1, backgroundColor: '#f2f2f7' },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: '#1a1a1a' },
  modalClose: { fontSize: 16, color: '#0066FF', fontWeight: '600' },

  searchInput: {
    margin: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    color: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },

  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#fff',
  },
  listRowContent: { flex: 1 },
  listRowAddress: { fontSize: 16, fontWeight: '500', color: '#1a1a1a' },
  listRowMeta: { fontSize: 13, color: '#6B7280', marginTop: 2 },
  listRowChevron: { fontSize: 20, color: '#C7C7CC', marginLeft: 8 },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: '#e0e0e0', marginLeft: 16 },

  emptyText: { textAlign: 'center', color: '#9CA3AF', fontSize: 15, marginTop: 24 },

  footer: { padding: 16, gap: 12 },
  manualWrap: { gap: 10 },
  manualInput: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    color: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  manualConfirmBtn: {
    backgroundColor: '#0066FF',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  manualConfirmText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  manualLink: { color: '#0066FF', fontSize: 15, fontWeight: '500', textAlign: 'center' },
  manageLink: { color: '#6B7280', fontSize: 14, textAlign: 'center' },
});
