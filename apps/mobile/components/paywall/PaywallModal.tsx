/**
 * PaywallModal
 *
 * Full-screen bottom sheet presenting the Professional upgrade offer.
 * Shows monthly and annual plans with a 14-day free trial.
 * Uses @gorhom/bottom-sheet (already installed).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  Alert, Linking, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import { getOfferings, purchasePackage, restorePurchases } from '../../lib/purchases';
import { useSubscriptionStore } from '../../store/subscription';
import type { PurchasesPackage } from 'react-native-purchases';

// ─── Feature list shown in paywall ─────────────────────────────────────────���─

const FEATURES = [
  { icon: 'document-text-outline' as const, label: 'Contract X-Ray & Opus ingest' },
  { icon: 'camera-outline' as const,        label: 'Content Studio + Virtual Staging' },
  { icon: 'map-outline' as const,           label: 'Route Optimization' },
  { icon: 'home-outline' as const,          label: 'Open House Kiosk' },
  { icon: 'bulb-outline' as const,          label: 'Field Oracle & Property Research' },
];

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  visible: boolean;
  onClose(): void;
  /** Context-specific title, e.g. "Unlock Contract X-Ray" */
  contextTitle?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PaywallModal({ visible, onClose, contextTitle }: Props) {
  const sheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => ['92%'], []);

  const [selectedPlan, setSelectedPlan] = useState<'monthly' | 'annual'>('annual');
  const [monthly, setMonthly] = useState<PurchasesPackage | null>(null);
  const [annual, setAnnual] = useState<PurchasesPackage | null>(null);
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const syncAfterPurchase = useSubscriptionStore(s => s.syncAfterPurchase);

  // Load offerings once when modal first opens
  useEffect(() => {
    if (!visible) return;
    getOfferings().then(offerings => {
      if (!offerings?.current) return;
      for (const pkg of offerings.current.availablePackages) {
        if (pkg.packageType === 'MONTHLY') setMonthly(pkg);
        if (pkg.packageType === 'ANNUAL')  setAnnual(pkg);
      }
    }).catch(() => {});
  }, [visible]);

  useEffect(() => {
    if (visible) sheetRef.current?.expand();
    else         sheetRef.current?.close();
  }, [visible]);

  const selectedPackage = selectedPlan === 'monthly' ? monthly : annual;

  const handlePurchase = useCallback(async () => {
    if (!selectedPackage) return;
    setPurchasing(true);
    try {
      await purchasePackage(selectedPackage);
      await syncAfterPurchase();
      onClose();
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code !== 'PURCHASE_CANCELLED') {
        Alert.alert('Purchase Failed', 'Please try again or contact support.');
      }
    } finally {
      setPurchasing(false);
    }
  }, [selectedPackage, syncAfterPurchase, onClose]);

  const handleRestore = useCallback(async () => {
    setRestoring(true);
    try {
      await restorePurchases();
      await syncAfterPurchase();
      onClose();
      Alert.alert('Purchases Restored', 'Your subscription has been restored.');
    } catch {
      Alert.alert('Restore Failed', 'No previous purchase found for this account.');
    } finally {
      setRestoring(false);
    }
  }, [syncAfterPurchase, onClose]);

  if (!visible) return null;

  return (
    <BottomSheet
      ref={sheetRef}
      snapPoints={snapPoints}
      enablePanDownToClose
      onClose={onClose}
      backgroundStyle={styles.sheetBg}
      handleIndicatorStyle={styles.handle}
    >
      <BottomSheetView style={styles.container}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          {/* Close button */}
          <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={16}>
            <Ionicons name="close" size={22} color="#6B7280" />
          </TouchableOpacity>

          {/* Header */}
          <View style={styles.header}>
            <View style={styles.proIcon}>
              <Ionicons name="star" size={28} color="#fff" />
            </View>
            <Text style={styles.title}>
              {contextTitle ?? 'Unlock Professional'}
            </Text>
            <Text style={styles.subtitle}>
              Start your 14-day free trial — no charge until it ends.
            </Text>
          </View>

          {/* Feature list */}
          <View style={styles.featureList}>
            {FEATURES.map(f => (
              <View key={f.label} style={styles.featureRow}>
                <View style={styles.featureIconWrap}>
                  <Ionicons name={f.icon} size={18} color="#6366F1" />
                </View>
                <Text style={styles.featureText}>{f.label}</Text>
              </View>
            ))}
          </View>

          {/* Plan selector */}
          <View style={styles.planRow}>
            <TouchableOpacity
              style={[styles.planCard, selectedPlan === 'monthly' && styles.planCardActive]}
              onPress={() => setSelectedPlan('monthly')}
              activeOpacity={0.8}
            >
              <Text style={[styles.planPrice, selectedPlan === 'monthly' && styles.planPriceActive]}>
                {monthly?.product.priceString ?? '$79.99'}
              </Text>
              <Text style={[styles.planPeriod, selectedPlan === 'monthly' && styles.planPeriodActive]}>/ month</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.planCard, selectedPlan === 'annual' && styles.planCardActive]}
              onPress={() => setSelectedPlan('annual')}
              activeOpacity={0.8}
            >
              <View style={styles.bestValueBadge}>
                <Text style={styles.bestValueText}>Best Value</Text>
              </View>
              <Text style={[styles.planPrice, selectedPlan === 'annual' && styles.planPriceActive]}>
                $69
              </Text>
              <Text style={[styles.planPeriod, selectedPlan === 'annual' && styles.planPeriodActive]}>/ month</Text>
              <Text style={styles.planAnnualNote}>
                {annual?.product.priceString ?? '$828.00'} billed annually
              </Text>
            </TouchableOpacity>
          </View>

          {/* CTA */}
          <TouchableOpacity
            style={[styles.ctaBtn, purchasing && styles.ctaBtnDisabled]}
            onPress={() => void handlePurchase()}
            disabled={purchasing || !selectedPackage}
            activeOpacity={0.85}
          >
            {purchasing
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.ctaText}>Start 14-Day Free Trial</Text>
            }
          </TouchableOpacity>

          {/* Restore + legal */}
          <TouchableOpacity onPress={() => void handleRestore()} disabled={restoring} style={styles.restoreRow}>
            {restoring
              ? <ActivityIndicator size="small" color="#9CA3AF" />
              : <Text style={styles.restoreText}>Restore Purchase</Text>
            }
          </TouchableOpacity>

          <Text style={styles.legal}>
            Subscription auto-renews at the end of each period unless cancelled at least 24 hours before the renewal date. Manage or cancel in App Store / Google Play settings.
          </Text>

          {/* Team pricing CTA */}
          <TouchableOpacity
            onPress={() => void Linking.openURL('mailto:team@realclaw.com?subject=Team%20Pricing')}
            style={styles.teamRow}
          >
            <Text style={styles.teamText}>10+ agents? Contact us for team pricing →</Text>
          </TouchableOpacity>
        </ScrollView>
      </BottomSheetView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheetBg: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  handle: { backgroundColor: '#E5E7EB', width: 40 },
  container: { flex: 1 },
  scroll: { paddingHorizontal: 24, paddingBottom: 40 },
  closeBtn: { alignSelf: 'flex-end', marginTop: 8, padding: 8 },
  header: { alignItems: 'center', marginBottom: 20 },
  proIcon: {
    width: 64, height: 64, borderRadius: 20,
    backgroundColor: '#6366F1', alignItems: 'center', justifyContent: 'center',
    marginBottom: 14,
  },
  title: { fontSize: 22, fontWeight: '800', color: '#111827', textAlign: 'center', marginBottom: 6 },
  subtitle: { fontSize: 14, color: '#6B7280', textAlign: 'center', lineHeight: 20 },
  featureList: { marginBottom: 20, gap: 10 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  featureIconWrap: {
    width: 34, height: 34, borderRadius: 10,
    backgroundColor: '#EEF2FF', alignItems: 'center', justifyContent: 'center',
  },
  featureText: { fontSize: 14, color: '#374151', fontWeight: '500', flex: 1 },
  planRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  planCard: {
    flex: 1, borderRadius: 16, borderWidth: 2, borderColor: '#E5E7EB',
    backgroundColor: '#F9FAFB', padding: 16, alignItems: 'center', position: 'relative',
    paddingTop: 20,
  },
  planCardActive: { borderColor: '#6366F1', backgroundColor: '#EEF2FF' },
  bestValueBadge: {
    position: 'absolute', top: -10, backgroundColor: '#6366F1',
    borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3,
  },
  bestValueText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  planPrice: { fontSize: 28, fontWeight: '800', color: '#6B7280' },
  planPriceActive: { color: '#6366F1' },
  planPeriod: { fontSize: 13, color: '#9CA3AF', marginTop: 2 },
  planPeriodActive: { color: '#6366F1' },
  planAnnualNote: { fontSize: 11, color: '#9CA3AF', marginTop: 4, textAlign: 'center' },
  ctaBtn: {
    backgroundColor: '#6366F1', borderRadius: 16,
    paddingVertical: 16, alignItems: 'center', marginBottom: 12,
  },
  ctaBtnDisabled: { opacity: 0.6 },
  ctaText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  restoreRow: { alignItems: 'center', marginBottom: 12 },
  restoreText: { color: '#6B7280', fontSize: 13 },
  legal: { fontSize: 11, color: '#9CA3AF', textAlign: 'center', lineHeight: 16, marginBottom: 16 },
  teamRow: { alignItems: 'center' },
  teamText: { fontSize: 13, color: '#6366F1', fontWeight: '600' },
});
