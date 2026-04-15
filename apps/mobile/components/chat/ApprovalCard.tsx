import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { authedFetch } from '../../lib/api';

interface Props {
  approvalId: string;
  description: string;
  onResolved: () => void;
}

export function ApprovalCard({ approvalId, description, onResolved }: Props) {
  const [loading, setLoading] = useState(false);

  async function handleDecision(decision: 'approved' | 'rejected') {
    if (decision === 'approved') {
      // Biometric gate (Phase 4, Decision 13: client-side soft check)
      const bioAvailable = await LocalAuthentication.hasHardwareAsync();
      if (bioAvailable) {
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: 'Confirm approval',
          cancelLabel: 'Cancel',
        });
        if (!result.success) return;  // user cancelled or failed
      }
    }

    setLoading(true);
    try {
      const res = await authedFetch(`/v1/approvals/${approvalId}`, {
        method: 'POST',
        body: JSON.stringify({
          approvalId,
          decision,
          biometricConfirmed: decision === 'approved',
          decidedAt: new Date().toISOString(),
        }),
      });

      if (!res.ok) {
        const err = await res.json() as { error: string };
        Alert.alert('Error', err.error ?? 'Failed to submit decision');
        return;
      }

      onResolved();
    } catch (err) {
      Alert.alert('Error', (err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Approval Required</Text>
      <Text style={styles.description}>{description}</Text>

      {loading ? (
        <ActivityIndicator color="#0066FF" style={styles.loader} />
      ) : (
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.button, styles.rejectButton]}
            onPress={() => handleDecision('rejected')}
          >
            <Text style={styles.rejectText}>Reject</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.approveButton]}
            onPress={() => handleDecision('approved')}
          >
            <Text style={styles.approveText}>Approve</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    margin: 12,
    padding: 16,
    backgroundColor: '#fff8e6',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ffcc00',
  },
  title: { fontSize: 14, fontWeight: '700', color: '#996600', marginBottom: 8 },
  description: { fontSize: 15, color: '#333', marginBottom: 16, lineHeight: 22 },
  loader: { marginVertical: 12 },
  actions: { flexDirection: 'row', gap: 12 },
  button: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  approveButton: { backgroundColor: '#0066FF' },
  rejectButton: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd' },
  approveText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  rejectText: { color: '#333', fontWeight: '600', fontSize: 16 },
});
