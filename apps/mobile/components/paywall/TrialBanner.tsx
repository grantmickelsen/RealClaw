/**
 * TrialBanner
 *
 * Shown at the top of the Home (Briefing) screen during the 14-day trial.
 * Displays a countdown and links to the subscription management screen.
 * Dismissible per app session; reappears on next cold launch.
 */
import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSubscriptionStore } from '../../store/subscription';

export function TrialBanner() {
  const isTrialing  = useSubscriptionStore(s => s.isTrialing);
  const trialEndsAt = useSubscriptionStore(s => s.trialEndsAt);
  const [dismissed, setDismissed] = useState(false);

  const daysLeft = useMemo(() => {
    if (!trialEndsAt) return null;
    const ms = new Date(trialEndsAt).getTime() - Date.now();
    return Math.max(0, Math.ceil(ms / 86_400_000));
  }, [trialEndsAt]);

  if (!isTrialing || dismissed || daysLeft === null) return null;

  const label = daysLeft === 0
    ? 'Your trial ends today — subscribe to keep full access'
    : `${daysLeft} day${daysLeft !== 1 ? 's' : ''} left in your Professional trial`;

  return (
    <TouchableOpacity
      style={[styles.banner, daysLeft <= 3 && styles.bannerUrgent]}
      onPress={() => router.push('/(main)/subscription' as never)}
      activeOpacity={0.85}
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons
        name="flash"
        size={14}
        color="#fff"
        style={styles.icon}
      />
      <Text style={styles.text} numberOfLines={1}>{label}</Text>
      <TouchableOpacity onPress={() => setDismissed(true)} hitSlop={12} style={styles.dismissBtn}>
        <Ionicons name="close" size={14} color="rgba(255,255,255,0.7)" />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#6366F1',
    marginHorizontal: 16, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 9,
    marginBottom: 12, gap: 8,
  },
  bannerUrgent: { backgroundColor: '#EF4444' },
  icon: { flexShrink: 0 },
  text: { color: '#fff', fontWeight: '600', fontSize: 13, flex: 1 },
  dismissBtn: { marginLeft: 4 },
});
