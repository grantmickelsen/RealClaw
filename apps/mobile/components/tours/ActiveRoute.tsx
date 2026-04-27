import { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { VoiceInput } from '../VoiceInput';
import { AccessCodeTile } from './AccessCodeTile';
import { FieldOracleSheet } from './FieldOracleSheet';
import { StopProgress } from './StopProgress';
import { openNavigation } from '../../lib/maps';
import { authedFetch } from '../../lib/api';
import { useToursStore } from '../../store/tours';

// ─── Access status config ────────────────────────────────────────────────────

const ACCESS_META = {
  confirmed:   { label: 'Access Confirmed', color: '#15803D', bg: '#DCFCE7', icon: 'checkmark-circle' as const },
  not_needed:  { label: 'Go Direct',        color: '#15803D', bg: '#DCFCE7', icon: 'walk-outline' as const },
  negotiating: { label: 'Awaiting Confirm', color: '#D97706', bg: '#FEF3C7', icon: 'time-outline' as const },
  failed:      { label: 'Access Failed',    color: '#DC2626', bg: '#FEE2E2', icon: 'close-circle' as const },
  pending:     { label: 'Pending Access',   color: '#6B7280', bg: '#F3F4F6', icon: 'ellipsis-horizontal' as const },
};

function formatTime(isoString: string | null): string {
  if (!isoString) return '';
  return new Date(isoString).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatEndTime(isoString: string | null, durationMinutes: number): string {
  if (!isoString) return '';
  const end = new Date(new Date(isoString).getTime() + durationMinutes * 60_000);
  return end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

// ─── Component ──────────────────────────────────────────────────────────────

interface Props {
  onBack(): void;
}

export function ActiveRoute({ onBack }: Props) {
  const [noteSaving, setNoteSaving] = useState(false);

  const activeShowingDayId = useToursStore((s) => s.activeShowingDayId);
  const activeStops        = useToursStore((s) => s.activeStops);
  const currentStopIndex   = useToursStore((s) => s.currentStopIndex);
  const activeRoute        = useToursStore((s) => s.activeRoute);
  const setCurrentStopIndex = useToursStore((s) => s.setCurrentStopIndex);
  const markArrived         = useToursStore((s) => s.markArrived);
  const setFieldOracle      = useToursStore((s) => s.setFieldOracle);

  const stop = activeStops[currentStopIndex];
  const isLast = currentStopIndex === activeStops.length - 1;
  const hasArrived = !!(stop?.arrivedAt);

  const accessMeta = stop ? ACCESS_META[stop.accessStatus] : ACCESS_META.pending;

  const handleNavigate = useCallback(async () => {
    if (!stop) return;
    try {
      await openNavigation(stop.address);
    } catch {
      Alert.alert('Navigation', 'Could not open maps application.');
    }
  }, [stop]);

  const handleArrived = useCallback(async () => {
    if (!stop || !activeShowingDayId) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    markArrived(stop.id);
    setFieldOracle(null, true);

    try {
      const res = await authedFetch(`/v1/tours/days/${activeShowingDayId}/arrive`, {
        method: 'POST',
        body: JSON.stringify({ stopId: stop.id }),
      });
      if (res.ok) {
        const data = await res.json() as { correlationId?: string };
        if (data.correlationId) {
          setFieldOracle(null, true, data.correlationId);
        }
      }
    } catch {
      setFieldOracle(null, false);
    }
  }, [stop, activeShowingDayId, markArrived, setFieldOracle]);

  const handleNextStop = useCallback(() => {
    if (isLast) {
      Alert.alert(
        'Complete Tour',
        'Mark this tour as complete? Reports will be generated for you and your client.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Complete Tour',
            style: 'default',
            onPress: async () => {
              try {
                await authedFetch(`/v1/tours/days/${activeShowingDayId}/complete`, {
                  method: 'POST',
                });
              } catch { /* best-effort */ }
              onBack();
            },
          },
        ],
      );
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      setCurrentStopIndex(currentStopIndex + 1);
    }
  }, [isLast, currentStopIndex, setCurrentStopIndex, activeShowingDayId, onBack]);

  const handleNote = useCallback(async (transcript: string) => {
    if (!stop || !activeShowingDayId || !transcript.trim()) return;
    setNoteSaving(true);
    try {
      await authedFetch(`/v1/tours/days/${activeShowingDayId}/notes`, {
        method: 'POST',
        body: JSON.stringify({ stopId: stop.id, transcript }),
      });
    } catch {
      useToursStore.getState().addPendingNote({
        id: `${Date.now()}`,
        showingDayPropertyId: stop.id,
        transcript,
      });
    } finally {
      setNoteSaving(false);
    }
  }, [stop, activeShowingDayId]);

  if (!stop) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}>
          <Text style={styles.emptyText}>No stops on this tour.</Text>
          <TouchableOpacity onPress={onBack} style={styles.backBtn}>
            <Text style={styles.backBtnText}>Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const contactName = useToursStore.getState().showingDays.find(
    (d) => d.id === activeShowingDayId,
  )?.contactName ?? null;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton} hitSlop={12}>
          <Ionicons name="chevron-down" size={22} color="#0066FF" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerContact} numberOfLines={1}>
            {contactName ?? 'Tour'}
          </Text>
          <Text style={styles.headerProgress}>
            Stop {currentStopIndex + 1} of {activeStops.length}
          </Text>
        </View>
        {activeRoute?.mapsUrl ? (
          <TouchableOpacity
            hitSlop={12}
            onPress={() => Alert.alert(
              'Full Route',
              'Share the full route link?',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Open Route',
                  onPress: async () => {
                    const { Linking } = await import('react-native');
                    Linking.openURL(activeRoute.mapsUrl).catch(() => {});
                  },
                },
              ],
            )}
          >
            <Ionicons name="map-outline" size={22} color="#0066FF" />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 22 }} />
        )}
      </View>

      {/* Stop progress dots */}
      <StopProgress stops={activeStops} currentIndex={currentStopIndex} />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Property photo */}
        <View style={styles.photoCard}>
          {stop.photos[0] ? (
            <Image
              source={{ uri: stop.photos[0] }}
              style={styles.propertyPhoto}
              resizeMode="cover"
            />
          ) : (
            <View style={[styles.propertyPhoto, styles.photoPlaceholder]}>
              <Text style={styles.photoPlaceholderText}>🏠</Text>
            </View>
          )}

          {/* Address overlay */}
          <View style={styles.addressOverlay}>
            <Text style={styles.propertyAddr} numberOfLines={2}>{stop.address}</Text>
            {stop.scheduledTime && (
              <Text style={styles.timeWindow}>
                {formatTime(stop.scheduledTime)} – {formatEndTime(stop.scheduledTime, stop.durationMinutes)}
              </Text>
            )}
          </View>
        </View>

        {/* Access status badge */}
        <View style={[styles.accessBadge, { backgroundColor: accessMeta.bg }]}>
          <Ionicons name={accessMeta.icon} size={16} color={accessMeta.color} />
          <Text style={[styles.accessLabel, { color: accessMeta.color }]}>
            {accessMeta.label}
          </Text>
        </View>

        {/* Access code — shown when confirmed */}
        {(stop.accessStatus === 'confirmed' || stop.accessStatus === 'not_needed') &&
          stop.accessNotes && (
            <AccessCodeTile code={stop.accessNotes} />
          )}

        {/* Warnings for failed access */}
        {stop.accessStatus === 'failed' && (
          <View style={styles.warningCard}>
            <Ionicons name="warning-outline" size={16} color="#DC2626" />
            <Text style={styles.warningText}>
              Access confirmation failed. Call the listing agent to coordinate entry.
            </Text>
          </View>
        )}

        {/* Route warnings */}
        {activeRoute?.warnings && activeRoute.warnings.length > 0 && (
          <View style={styles.warningCard}>
            <Ionicons name="time-outline" size={16} color="#D97706" />
            <Text style={styles.warningText}>{activeRoute.warnings[0]}</Text>
          </View>
        )}

        {/* Field Oracle */}
        <FieldOracleSheet address={stop.address} />

        {/* Voice notes */}
        <View style={styles.noteSection}>
          <Text style={styles.noteLabel}>
            Notes for {stop.address.split(',')[0]}
          </Text>
          <View style={styles.voiceRow}>
            <VoiceInput onTranscript={handleNote} disabled={noteSaving} />
            <Text style={styles.voiceHint}>
              {noteSaving ? 'Saving…' : 'Press & hold to record'}
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* Action buttons */}
      <View style={styles.actions}>
        <TouchableOpacity style={styles.btnNavigate} onPress={handleNavigate}>
          <Ionicons name="navigate-outline" size={18} color="#0066FF" />
          <Text style={styles.btnNavigateText}>Navigate</Text>
        </TouchableOpacity>

        {!hasArrived ? (
          <TouchableOpacity style={styles.btnArrived} onPress={handleArrived}>
            <Text style={styles.btnArrivedText}>I've Arrived</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.btnNext, isLast && styles.btnComplete]}
            onPress={handleNextStop}
          >
            <Text style={styles.btnNextText}>
              {isLast ? 'Complete Tour' : 'Next Stop →'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3F4F6',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  emptyText: { fontSize: 16, color: '#9CA3AF' },
  backBtn: {
    backgroundColor: '#0066FF',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  backBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
  },
  backButton: {
    width: 32,
    alignItems: 'flex-start',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerContact: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  headerProgress: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 1,
  },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 20,
    gap: 12,
  },
  photoCard: {
    borderRadius: 16,
    overflow: 'hidden',
    height: 200,
    backgroundColor: '#E5E7EB',
  },
  propertyPhoto: {
    width: '100%',
    height: '100%',
  },
  photoPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoPlaceholderText: { fontSize: 48 },
  addressOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  propertyAddr: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  timeWindow: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 2,
  },
  accessBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
  },
  accessLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  warningCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#FFF7ED',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#FED7AA',
  },
  warningText: {
    flex: 1,
    fontSize: 13,
    color: '#92400E',
    lineHeight: 19,
  },
  noteSection: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
  },
  noteLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6B7280',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  voiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  voiceHint: {
    fontSize: 13,
    color: '#9CA3AF',
    flex: 1,
  },
  actions: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e0e0e0',
  },
  btnNavigate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#0066FF',
    backgroundColor: '#fff',
  },
  btnNavigateText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0066FF',
  },
  btnArrived: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: '#0066FF',
  },
  btnArrivedText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  btnNext: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: '#374151',
  },
  btnComplete: {
    backgroundColor: '#15803D',
  },
  btnNextText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
});
