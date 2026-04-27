/**
 * FeatureLock
 *
 * Renders children normally for Professional users.
 * For Starter users, renders children blurred with a lock overlay.
 * "Show, don't hide" — users convert better when they see the feature.
 */
import React from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSubscriptionStore } from '../../store/subscription';

interface Props {
  children: React.ReactNode;
  /** Short label shown in the lock badge, e.g. "Contract X-Ray" */
  featureLabel: string;
  /** Called when the user taps the upgrade CTA */
  onUpgrade(): void;
  /** Override to always show the lock regardless of subscription state (testing) */
  forcelock?: boolean;
}

export function FeatureLock({ children, featureLabel, onUpgrade, forcelock }: Props) {
  const isProfessional = useSubscriptionStore(s => s.isProfessional);

  if (isProfessional && !forcelock) {
    return <>{children}</>;
  }

  return (
    <View style={styles.container}>
      {/* Render children but visually dimmed */}
      <View style={styles.blurOverlay} pointerEvents="none">
        {children}
      </View>

      {/* Lock overlay */}
      <View style={styles.lockOverlay}>
        <View style={styles.lockCard}>
          <View style={styles.iconWrap}>
            <Ionicons name="lock-closed" size={28} color="#fff" />
          </View>
          <Text style={styles.featureLabel}>{featureLabel}</Text>
          <Text style={styles.subtitle}>Available on Professional</Text>
          <TouchableOpacity
            style={styles.upgradeBtn}
            onPress={onUpgrade}
            activeOpacity={0.85}
            accessible
            accessibilityLabel={`Upgrade to unlock ${featureLabel}`}
            accessibilityRole="button"
          >
            <Text style={styles.upgradeBtnText}>✦ Unlock Professional</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { position: 'relative' },
  blurOverlay: { opacity: 0.18 },
  lockOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  lockCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 8,
    width: '100%',
    maxWidth: 300,
  },
  iconWrap: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#6366F1',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 12,
  },
  featureLabel: {
    fontSize: 17, fontWeight: '700', color: '#111827', textAlign: 'center', marginBottom: 4,
  },
  subtitle: {
    fontSize: 13, color: '#6B7280', textAlign: 'center', marginBottom: 16,
  },
  upgradeBtn: {
    backgroundColor: '#6366F1',
    borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24, width: '100%',
    alignItems: 'center',
  },
  upgradeBtnText: {
    color: '#fff', fontWeight: '700', fontSize: 15,
  },
});
