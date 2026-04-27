import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useKioskStore } from '../../store/kiosk';
import { useSubscriptionStore } from '../../store/subscription';
import { loadTodayGuests } from '../../lib/db';
import { useState, useEffect } from 'react';

interface GrowthCard {
  id: string;
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconBg: string;
  route: string;
}

const CARDS: GrowthCard[] = [
  {
    id: 'studio',
    title: 'Content Studio',
    subtitle: 'Generate listing copy, social captions, and virtual staging',
    icon: 'camera-outline',
    iconBg: '#6366F1',
    route: '/(main)/studio',
  },
  {
    id: 'open_house',
    title: 'Open House',
    subtitle: 'Activate kiosk mode, collect sign-ins, and debrief guests',
    icon: 'home-outline',
    iconBg: '#0066FF',
    route: '/(main)/kiosk',
  },
];

export default function GrowthScreen() {
  const isKioskActive = useKioskStore(s => s.isActive);
  const isProfessional = useSubscriptionStore(s => s.isProfessional);
  const [todayGuestCount, setTodayGuestCount] = useState(0);
  const [paywallVisible, setPaywallVisible] = useState(false);
  const [paywallContext, setPaywallContext] = useState('');

  useEffect(() => {
    loadTodayGuests().then(guests => setTodayGuestCount(guests.length)).catch(() => {});
  }, [isKioskActive]);

  // Lazy import to avoid loading RevenueCat until needed
  const PaywallModal = require('../../components/paywall/PaywallModal').PaywallModal as typeof import('../../components/paywall/PaywallModal').PaywallModal;

  function handleCardPress(card: GrowthCard) {
    if (!isProfessional) {
      setPaywallContext(`Unlock ${card.title}`);
      setPaywallVisible(true);
      return;
    }
    router.push(card.route as never);
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Growth</Text>
        <Text style={styles.headerSub}>Marketing & open house tools</Text>
      </View>

      {/* Active open house banner */}
      {isKioskActive && (
        <TouchableOpacity
          style={styles.activeBanner}
          onPress={() => router.push('/(main)/kiosk' as never)}
          activeOpacity={0.85}
        >
          <View style={styles.activeDot} />
          <Text style={styles.activeBannerText}>
            Open House Active — {todayGuestCount} sign-in{todayGuestCount !== 1 ? 's' : ''} today
          </Text>
          <Ionicons name="chevron-forward" size={16} color="#fff" />
        </TouchableOpacity>
      )}

      <View style={styles.cards}>
        {CARDS.map(card => (
          <TouchableOpacity
            key={card.id}
            style={styles.card}
            onPress={() => handleCardPress(card)}
            activeOpacity={0.75}
            accessible={true}
            accessibilityLabel={card.title}
            accessibilityRole="button"
          >
            <View style={[styles.cardIcon, { backgroundColor: card.iconBg }]}>
              <Ionicons name={card.icon} size={28} color="#fff" />
            </View>
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle}>{card.title}</Text>
              <Text style={styles.cardSubtitle}>{card.subtitle}</Text>
            </View>
            {isProfessional
              ? <Ionicons name="chevron-forward" size={20} color="#C4C9D4" />
              : <View style={styles.proBadge}><Text style={styles.proBadgeText}>✦ Pro</Text></View>
            }
          </TouchableOpacity>
        ))}
      </View>

      <PaywallModal
        visible={paywallVisible}
        onClose={() => setPaywallVisible(false)}
        contextTitle={paywallContext}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  header: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 20 },
  headerTitle: { fontSize: 28, fontWeight: '700', color: '#1a1a1a' },
  headerSub: { fontSize: 14, color: '#6B7280', marginTop: 2 },
  activeBanner: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#0066FF', marginHorizontal: 16, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 10, marginBottom: 16,
  },
  activeDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: '#fff', marginRight: 8,
  },
  activeBannerText: { color: '#fff', fontWeight: '600', flex: 1 },
  cards: { paddingHorizontal: 16, gap: 12 },
  proBadge: {
    backgroundColor: '#6366F1', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  proBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  card: {
    backgroundColor: '#fff', borderRadius: 14,
    padding: 16, flexDirection: 'row', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  cardIcon: {
    width: 52, height: 52, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center', marginRight: 14,
  },
  cardBody: { flex: 1 },
  cardTitle: { fontSize: 17, fontWeight: '600', color: '#111827', marginBottom: 3 },
  cardSubtitle: { fontSize: 13, color: '#6B7280', lineHeight: 18 },
});
