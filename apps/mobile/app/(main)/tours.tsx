import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SectionList,
  RefreshControl,
  ActivityIndicator,
  Alert,
  ActionSheetIOS,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import BottomSheet, { BottomSheetFlatList } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { authedFetch } from '../../lib/api';
import {
  useToursStore,
  type ShowingDay,
  type ShowingStop,
  type ShowingRoute,
  type PropertyResult,
} from '../../store/tours';
import { useContactsStore } from '../../store/contacts';
import { useSubscriptionStore } from '../../store/subscription';
import { PaywallModal } from '../../components/paywall/PaywallModal';
import { ShowingDayCard } from '../../components/tours/ShowingDayCard';
import { PropertySwipeStack } from '../../components/tours/PropertySwipeStack';
import { ActiveRoute } from '../../components/tours/ActiveRoute';

// ─── Types ───────────────────────────────────────────────────────────────────

interface DayDetailResponse {
  day: ShowingDay;
  stops: ShowingStop[];
  route: ShowingRoute | null;
}

interface DayListResponse {
  days: ShowingDay[];
}

interface SearchResultsResponse {
  results: PropertyResult[];
  contactName: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sectionizeDays(
  days: ShowingDay[],
): Array<{ title: string; data: ShowingDay[] }> {
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = days.filter(
    (d) => d.proposedDate >= today && d.status !== 'completed' && d.status !== 'cancelled',
  );
  const past = days.filter(
    (d) => d.proposedDate < today || d.status === 'completed' || d.status === 'cancelled',
  );
  const sections: Array<{ title: string; data: ShowingDay[] }> = [];
  if (upcoming.length > 0)
    sections.push({ title: 'UPCOMING', data: upcoming });
  if (past.length > 0)
    sections.push({ title: 'PAST', data: past });
  return sections;
}

// ─── Contact picker sheet ────────────────────────────────────────────────────

function ContactPickerSheet({
  sheetRef,
  onSelect,
}: {
  sheetRef: React.RefObject<BottomSheet | null>;
  onSelect: (contactId: string, contactName: string | null) => void;
}) {
  const contacts = useContactsStore((s) => s.contacts);
  return (
    <BottomSheet
      ref={sheetRef}
      index={-1}
      snapPoints={['55%']}
      enablePanDownToClose
      backgroundStyle={styles.sheetBg}
      handleIndicatorStyle={styles.handle}
    >
      <View style={styles.pickerHeader}>
        <Text style={styles.pickerTitle}>Schedule a Tour</Text>
        <Text style={styles.pickerSubtitle}>
          Select a buyer to begin planning their showing day.
        </Text>
      </View>
      <BottomSheetFlatList
        data={contacts}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.pickerList}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.pickerRow}
            onPress={() => {
              sheetRef.current?.close();
              onSelect(item.id, item.name);
            }}
          >
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarInitial}>
                {(item.name ?? '?').charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={styles.pickerInfo}>
              <Text style={styles.pickerName}>{item.name ?? 'Unknown'}</Text>
              {item.stage && (
                <Text style={styles.pickerStage}>{item.stage}</Text>
              )}
            </View>
            <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.pickerEmpty}>
            <Text style={styles.pickerEmptyText}>
              No contacts yet. Add a buyer in the Contacts tab first.
            </Text>
          </View>
        }
      />
    </BottomSheet>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function ToursScreen() {
  const pickerRef = useRef<BottomSheet>(null);
  const [stopsByDay, setStopsByDay] = useState<Record<string, ShowingStop[]>>({});
  const [expandedDayId, setExpandedDayId] = useState<string | null>(null);
  const [paywallVisible, setPaywallVisible] = useState(false);
  const isProfessional = useSubscriptionStore(s => s.isProfessional);

  const mode              = useToursStore((s) => s.mode);
  const setMode           = useToursStore((s) => s.setMode);
  const showingDays       = useToursStore((s) => s.showingDays);
  const loading           = useToursStore((s) => s.showingDaysLoading);
  const setShowingDays    = useToursStore((s) => s.setShowingDays);
  const setShowingDaysLoading = useToursStore((s) => s.setShowingDaysLoading);
  const pendingCurations  = useToursStore((s) => s.pendingCurations);
  const clearCuration     = useToursStore((s) => s.clearPendingCuration);
  const setSwipeQueue     = useToursStore((s) => s.setSwipeQueue);
  const swipeQueue        = useToursStore((s) => s.swipeQueue);
  const swipeIndex        = useToursStore((s) => s.swipeIndex);
  const swipeProperty     = useToursStore((s) => s.swipeProperty);
  const activeCurateContactName = useToursStore((s) => s.activeCurateContactName);
  const activeSearchId    = useToursStore((s) => s.activeSearchId);
  const setActiveShowingDay = useToursStore((s) => s.setActiveShowingDay);
  const exitLiveMode      = useToursStore((s) => s.exitLiveMode);

  const inProgressDay = showingDays.find((d) => d.status === 'in_progress');

  // ── Data loading ──────────────────────────────────────────────────────────

  const loadDays = useCallback(async () => {
    setShowingDaysLoading(true);
    try {
      const res = await authedFetch('/v1/tours/days');
      if (res.ok) {
        const data = await res.json() as DayListResponse;
        setShowingDays(data.days ?? []);
      }
    } catch { /* show stale */ } finally {
      setShowingDaysLoading(false);
    }
  }, [setShowingDays, setShowingDaysLoading]);

  useEffect(() => { void loadDays(); }, [loadDays]);

  // ── Day expand: load stops ─────────────────────────────────────────────────

  const handleDayPress = useCallback(async (dayId: string) => {
    if (expandedDayId === dayId) {
      setExpandedDayId(null);
      return;
    }
    setExpandedDayId(dayId);
    if (stopsByDay[dayId]) return;

    try {
      const res = await authedFetch(`/v1/tours/days/${dayId}`);
      if (res.ok) {
        const data = await res.json() as DayDetailResponse;
        setStopsByDay((prev) => ({ ...prev, [dayId]: data.stops }));
      }
    } catch { /* show empty stops */ }
  }, [expandedDayId, stopsByDay]);

  // ── Enter live mode ────────────────────────────────────────────────────────

  const handleLiveTap = useCallback(async (day: ShowingDay) => {
    try {
      const res = await authedFetch(`/v1/tours/days/${day.id}`);
      if (res.ok) {
        const data = await res.json() as DayDetailResponse;
        setActiveShowingDay(day.id, data.stops, data.route);
      } else {
        // Fallback: enter with whatever stops we already loaded
        const cached = stopsByDay[day.id] ?? [];
        setActiveShowingDay(day.id, cached, null);
      }
    } catch {
      const cached = stopsByDay[day.id] ?? [];
      setActiveShowingDay(day.id, cached, null);
    }
  }, [stopsByDay, setActiveShowingDay]);

  // ── Curation banner tap ────────────────────────────────────────────────────

  const handleCurateTap = useCallback(async (searchId: string, contactId: string) => {
    try {
      const res = await authedFetch(`/v1/tours/searches/${searchId}/results`);
      if (res.ok) {
        const data = await res.json() as SearchResultsResponse;
        setSwipeQueue(data.results, contactId, data.contactName, searchId);
        clearCuration(searchId);
      }
    } catch {
      Alert.alert('Error', 'Could not load property results. Try again.');
    }
  }, [setSwipeQueue, clearCuration]);

  // ── Swipe handlers ─────────────────────────────────────────────────────────

  const handleAdd = useCallback(async (propertyId: string) => {
    swipeProperty();
    try {
      await authedFetch('/v1/tours/swipe', {
        method: 'POST',
        body: JSON.stringify({ propertyResultId: propertyId, decision: 'yes' }),
      });
    } catch { /* offline — note saved locally by store */ }
  }, [swipeProperty]);

  const handleSkip = useCallback(async (propertyId: string) => {
    swipeProperty();
    try {
      await authedFetch('/v1/tours/swipe', {
        method: 'POST',
        body: JSON.stringify({ propertyResultId: propertyId, decision: 'no' }),
      });
    } catch { /* ignore */ }
  }, [swipeProperty]);

  // ── Schedule new day ───────────────────────────────────────────────────────

  const handleScheduleForContact = useCallback(async (contactId: string, contactName: string | null) => {
    if (!isProfessional) { setPaywallVisible(true); return; }
    try {
      const res = await authedFetch('/v1/tours/days', {
        method: 'POST',
        body: JSON.stringify({ contactId }),
      });
      if (res.ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        await loadDays();
        Alert.alert(
          'Tour Scheduled',
          `A showing day has been created for ${contactName ?? 'this contact'}. ` +
          'RealClaw will curate matching properties automatically.',
        );
      } else {
        Alert.alert('Error', 'Could not create showing day. Try again.');
      }
    } catch {
      Alert.alert('Error', 'Could not create showing day. Check your connection.');
    }
  }, [loadDays]);

  function handleAdd_press() {
    if (!isProfessional) { setPaywallVisible(true); return; }
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ['Cancel', 'Schedule for a Contact'], cancelButtonIndex: 0 },
        (idx) => {
          if (idx === 1) pickerRef.current?.snapToIndex(0);
        },
      );
    } else {
      pickerRef.current?.snapToIndex(0);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER — Live mode takes over full screen
  // ─────────────────────────────────────────────────────────────────────────

  if (mode === 'live') {
    return <ActiveRoute onBack={exitLiveMode} />;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER — Curate mode: full-screen swipe stack
  // ─────────────────────────────────────────────────────────────────────────

  if (mode === 'curate') {
    const remaining = swipeQueue.length - swipeIndex;
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => setMode('days')}
            style={styles.headerBack}
            hitSlop={12}
          >
            <Ionicons name="arrow-back" size={22} color="#0066FF" />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.curateTitle}>
              {activeCurateContactName
                ? `For ${activeCurateContactName}`
                : 'Property Review'}
            </Text>
            {remaining > 0 && (
              <Text style={styles.curateProgress}>
                {swipeIndex + 1} of {swipeQueue.length}
              </Text>
            )}
          </View>
          <View style={{ width: 32 }} />
        </View>

        {/* Progress bar */}
        {swipeQueue.length > 0 && (
          <View style={styles.progressBarBg}>
            <View
              style={[
                styles.progressBarFill,
                { width: `${(swipeIndex / swipeQueue.length) * 100}%` },
              ]}
            />
          </View>
        )}

        {/* Swipe stack */}
        <View style={styles.stackArea}>
          <PropertySwipeStack
            queue={swipeQueue}
            currentIndex={swipeIndex}
            contactName={activeCurateContactName}
            onAdd={(id) => { void handleAdd(id); }}
            onSkip={(id) => { void handleSkip(id); }}
          />
        </View>

        {/* Action bar (thumb-zone) */}
        {remaining > 0 && (
          <View style={styles.curateActions}>
            <TouchableOpacity
              style={styles.skipBtn}
              onPress={() => {
                const current = swipeQueue[swipeIndex];
                if (current) void handleSkip(current.id);
              }}
            >
              <Ionicons name="close" size={28} color="#FF3B30" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.addBtn}
              onPress={() => {
                const current = swipeQueue[swipeIndex];
                if (current) void handleAdd(current.id);
              }}
            >
              <Ionicons name="heart" size={28} color="#fff" />
            </TouchableOpacity>
          </View>
        )}
      </SafeAreaView>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER — Days hub (default)
  // ─────────────────────────────────────────────────────────────────────────

  const sections = sectionizeDays(showingDays);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Tours</Text>
        <TouchableOpacity onPress={handleAdd_press} hitSlop={12}>
          <Ionicons name="add" size={26} color="#0066FF" />
        </TouchableOpacity>
      </View>

      {/* Live session banner */}
      {inProgressDay && (
        <TouchableOpacity
          style={styles.liveBanner}
          onPress={() => { void handleLiveTap(inProgressDay); }}
          activeOpacity={0.9}
        >
          <View style={styles.livePulse} />
          <Text style={styles.liveBannerText}>
            LIVE — {inProgressDay.propertyCount} stops ·{' '}
            {inProgressDay.contactName ?? 'Tour in progress'}
          </Text>
          <Ionicons name="chevron-forward" size={16} color="#fff" />
        </TouchableOpacity>
      )}

      {/* Curate banners */}
      {pendingCurations.map((c) => (
        <TouchableOpacity
          key={c.searchId}
          style={styles.curateBanner}
          onPress={() => { void handleCurateTap(c.searchId, c.contactId); }}
          activeOpacity={0.85}
        >
          <Ionicons name="home-outline" size={15} color="#D97706" />
          <Text style={styles.curateBannerText}>
            {c.count} {c.count === 1 ? 'property' : 'properties'} ready to review
            {c.contactName ? ` for ${c.contactName}` : ''}
          </Text>
          <Ionicons name="chevron-forward" size={14} color="#D97706" />
        </TouchableOpacity>
      ))}

      {loading && showingDays.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#0066FF" />
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(day) => day.id}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
            </View>
          )}
          renderItem={({ item }) => (
            <ShowingDayCard
              day={item}
              stops={stopsByDay[item.id]}
              onPress={() => { void handleDayPress(item.id); }}
              onLiveTap={
                item.status === 'in_progress'
                  ? () => { void handleLiveTap(item); }
                  : undefined
              }
            />
          )}
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={loadDays}
              tintColor="#0066FF"
            />
          }
          contentContainerStyle={[
            styles.listContent,
            sections.length === 0 && styles.emptyContainer,
          ]}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>🗓️</Text>
              <Text style={styles.emptyTitle}>No tours yet</Text>
              <Text style={styles.emptySubtitle}>
                Tap + to schedule a showing day.{'\n'}
                RealClaw will automatically curate matching properties.
              </Text>
            </View>
          }
        />
      )}

      {/* Contact picker sheet */}
      <ContactPickerSheet
        sheetRef={pickerRef}
        onSelect={handleScheduleForContact}
      />
      <PaywallModal
        visible={paywallVisible}
        onClose={() => setPaywallVisible(false)}
        contextTitle="Unlock Full Showings & Route Optimization"
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F3F4F6' },

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
  headerBack: { width: 32 },
  headerCenter: { flex: 1, alignItems: 'center' },
  curateTitle: { fontSize: 16, fontWeight: '700', color: '#1a1a1a' },
  curateProgress: { fontSize: 12, color: '#6B7280', marginTop: 1 },

  // Live banner
  liveBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0066FF',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  livePulse: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#fff',
    opacity: 0.9,
  },
  liveBannerText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.2,
  },

  // Curate banner
  curateBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFBEB',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#FDE68A',
    gap: 8,
  },
  curateBannerText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#92400E',
  },

  // Section list
  sectionHeader: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 6,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9CA3AF',
    letterSpacing: 0.8,
  },
  listContent: {
    paddingBottom: 100,
  },
  emptyContainer: { flexGrow: 1 },

  // Empty state
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    paddingTop: 80,
    gap: 12,
  },
  emptyIcon: { fontSize: 52 },
  emptyTitle: { fontSize: 22, fontWeight: '700', color: '#1a1a1a', textAlign: 'center' },
  emptySubtitle: {
    fontSize: 15,
    color: '#9CA3AF',
    textAlign: 'center',
    lineHeight: 23,
  },

  // Curate mode
  progressBarBg: {
    height: 3,
    backgroundColor: '#E5E7EB',
  },
  progressBarFill: {
    height: 3,
    backgroundColor: '#0066FF',
  },
  stackArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 16,
    paddingBottom: 8,
  },
  curateActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 32,
    paddingVertical: 20,
    paddingBottom: 28,
  },
  skipBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
    borderWidth: 1.5,
    borderColor: '#FFE4E6',
  },
  addBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#0066FF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0066FF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
  },

  // Contact picker sheet
  sheetBg: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 16,
  },
  handle: { backgroundColor: '#D1D5DB', width: 36 },
  pickerHeader: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F3F4F6',
  },
  pickerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 3,
  },
  pickerSubtitle: { fontSize: 13, color: '#6B7280', lineHeight: 20 },
  pickerList: { paddingBottom: 40 },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F3F4F6',
    gap: 12,
  },
  avatarCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontSize: 16, fontWeight: '700', color: '#0066FF' },
  pickerInfo: { flex: 1 },
  pickerName: { fontSize: 15, fontWeight: '600', color: '#1a1a1a' },
  pickerStage: { fontSize: 12, color: '#9CA3AF', marginTop: 1 },
  pickerEmpty: {
    padding: 40,
    alignItems: 'center',
  },
  pickerEmptyText: {
    fontSize: 14,
    color: '#9CA3AF',
    textAlign: 'center',
    lineHeight: 22,
  },
});
