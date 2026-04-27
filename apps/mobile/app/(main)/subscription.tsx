import { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, Linking, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSubscriptionStore } from '../../store/subscription';
import { PaywallModal } from '../../components/paywall/PaywallModal';
import { restorePurchases } from '../../lib/purchases';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tierLabel(tier: string) {
  if (tier === 'professional') return 'Professional';
  if (tier === 'brokerage') return 'Brokerage';
  return 'Starter';
}

function statusLabel(status: string) {
  if (status === 'trialing') return 'Free Trial';
  if (status === 'active') return 'Active';
  if (status === 'past_due') return 'Past Due';
  if (status === 'cancelled') return 'Cancelled';
  if (status === 'paused') return 'Paused';
  return status;
}

function managementUrl() {
  return Platform.OS === 'ios'
    ? 'https://apps.apple.com/account/subscriptions'
    : 'https://play.google.com/store/account/subscriptions';
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SubscriptionScreen() {
  const tier       = useSubscriptionStore(s => s.tier);
  const status     = useSubscriptionStore(s => s.status);
  const isTrialing = useSubscriptionStore(s => s.isTrialing);
  const trialEndsAt = useSubscriptionStore(s => s.trialEndsAt);
  const expiresAt  = useSubscriptionStore(s => s.expiresAt);
  const isProfessional = useSubscriptionStore(s => s.isProfessional);
  const syncAfterPurchase = useSubscriptionStore(s => s.syncAfterPurchase);

  const [paywallVisible, setPaywallVisible] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const daysLeft = trialEndsAt
    ? Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86_400_000))
    : null;

  const handleRestore = useCallback(async () => {
    setRestoring(true);
    try {
      await restorePurchases();
      await syncAfterPurchase();
      Alert.alert('Restored', 'Your subscription has been restored.');
    } catch {
      Alert.alert('Nothing to Restore', 'No previous purchase found for this Apple ID / Google account.');
    } finally {
      setRestoring(false);
    }
  }, [syncAfterPurchase]);

  const handleManage = useCallback(() => {
    void Linking.openURL(managementUrl());
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={24} color="#0066FF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Subscription</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Current plan card */}
        <View style={[styles.planCard, isProfessional && styles.planCardPro]}>
          <View style={styles.planCardRow}>
            <View style={[styles.planBadge, isProfessional && styles.planBadgePro]}>
              <Text style={styles.planBadgeText}>{tierLabel(tier)}</Text>
            </View>
            <Text style={[styles.statusBadge, status === 'past_due' && styles.statusBadgeWarn]}>
              {statusLabel(status)}
            </Text>
          </View>

          {isTrialing && daysLeft !== null && (
            <View style={styles.trialRow}>
              <Ionicons name="flash" size={14} color={daysLeft <= 3 ? '#EF4444' : '#6366F1'} />
              <Text style={[styles.trialText, daysLeft <= 3 && styles.trialTextUrgent]}>
                {daysLeft === 0
                  ? 'Trial ends today'
                  : `${daysLeft} day${daysLeft !== 1 ? 's' : ''} remaining in trial`}
              </Text>
            </View>
          )}

          {!isTrialing && expiresAt && (
            <Text style={styles.expiresText}>
              Renews {new Date(expiresAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </Text>
          )}
        </View>

        {/* Upgrade CTA for Starter users */}
        {!isProfessional && (
          <TouchableOpacity style={styles.upgradeBtn} onPress={() => setPaywallVisible(true)} activeOpacity={0.85}>
            <Ionicons name="star" size={18} color="#fff" style={{ marginRight: 8 }} />
            <Text style={styles.upgradeBtnText}>Upgrade to Professional</Text>
          </TouchableOpacity>
        )}

        {/* Feature list */}
        <Text style={styles.sectionLabel}>
          {isProfessional ? 'Your Professional features' : 'Professional includes'}
        </Text>
        {[
          'Contract X-Ray & Opus ingest',
          'Content Studio + Virtual Staging',
          'Route Optimization',
          'Open House Kiosk',
          'Field Oracle & Property Research',
          'Unlimited SMS suggestions & email drafts',
        ].map(f => (
          <View key={f} style={styles.featureRow}>
            <Ionicons
              name={isProfessional ? 'checkmark-circle' : 'checkmark-circle-outline'}
              size={18}
              color={isProfessional ? '#6366F1' : '#9CA3AF'}
            />
            <Text style={[styles.featureText, !isProfessional && styles.featureTextMuted]}>{f}</Text>
          </View>
        ))}

        {/* Manage / Restore */}
        {isProfessional && (
          <TouchableOpacity style={styles.manageBtn} onPress={handleManage} activeOpacity={0.8}>
            <Text style={styles.manageBtnText}>Manage Subscription</Text>
            <Ionicons name="open-outline" size={16} color="#6366F1" />
          </TouchableOpacity>
        )}

        <TouchableOpacity style={styles.restoreBtn} onPress={() => void handleRestore()} disabled={restoring}>
          {restoring
            ? <ActivityIndicator size="small" color="#9CA3AF" />
            : <Text style={styles.restoreBtnText}>Restore Purchase</Text>
          }
        </TouchableOpacity>

        {/* Brokerage / team pricing */}
        <View style={styles.teamCard}>
          <Text style={styles.teamTitle}>10+ Agents?</Text>
          <Text style={styles.teamSub}>Contact us for Brokerage pricing — volume discounts at $59/seat.</Text>
          <TouchableOpacity
            onPress={() => void Linking.openURL('mailto:team@realclaw.com?subject=Brokerage%20Pricing')}
            style={styles.teamBtn}
          >
            <Text style={styles.teamBtnText}>Contact Us →</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <PaywallModal
        visible={paywallVisible}
        onClose={() => setPaywallVisible(false)}
        contextTitle="Upgrade to Professional"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB',
  },
  headerTitle: { fontSize: 17, fontWeight: '600', color: '#111827' },
  scroll: { padding: 16, gap: 16 },
  planCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 18,
    borderWidth: 2, borderColor: '#E5E7EB',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  planCardPro: { borderColor: '#6366F1', backgroundColor: '#EEF2FF' },
  planCardRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  planBadge: {
    backgroundColor: '#E5E7EB', borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 4,
  },
  planBadgePro: { backgroundColor: '#6366F1' },
  planBadgeText: { fontWeight: '700', fontSize: 13, color: '#374151' },
  statusBadge: { fontSize: 13, color: '#6B7280', fontWeight: '500' },
  statusBadgeWarn: { color: '#EF4444' },
  trialRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  trialText: { fontSize: 14, color: '#6366F1', fontWeight: '600' },
  trialTextUrgent: { color: '#EF4444' },
  expiresText: { fontSize: 13, color: '#6B7280' },
  upgradeBtn: {
    backgroundColor: '#6366F1', borderRadius: 14,
    paddingVertical: 14, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center',
  },
  upgradeBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  sectionLabel: { fontSize: 12, fontWeight: '700', color: '#9CA3AF', letterSpacing: 0.8, marginTop: 4 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  featureText: { fontSize: 14, color: '#374151', fontWeight: '500' },
  featureTextMuted: { color: '#9CA3AF' },
  manageBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#fff', borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: '#E5E7EB',
  },
  manageBtnText: { fontSize: 15, fontWeight: '600', color: '#6366F1' },
  restoreBtn: { alignItems: 'center', paddingVertical: 8 },
  restoreBtnText: { color: '#6B7280', fontSize: 14 },
  teamCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: '#E5E7EB',
  },
  teamTitle: { fontSize: 15, fontWeight: '700', color: '#111827', marginBottom: 4 },
  teamSub: { fontSize: 13, color: '#6B7280', lineHeight: 18, marginBottom: 10 },
  teamBtn: {},
  teamBtnText: { color: '#6366F1', fontWeight: '600', fontSize: 14 },
});
