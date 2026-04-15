import { useLocalSearchParams, router } from 'expo-router';
import { View, Text, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEffect, useState } from 'react';
import { ApprovalCard } from '../../components/chat/ApprovalCard';
import { authedFetch } from '../../lib/api';

interface ApprovalDetail {
  approvalId: string;
  description: string;
  requestedBy: string;
  expiresAt: string;
}

export default function ApprovalScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [approval, setApproval] = useState<ApprovalDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    authedFetch(`/v1/approvals/${id}`)
      .then(res => {
        if (res.ok) return res.json() as Promise<ApprovalDetail>;
        throw new Error('Approval not found');
      })
      .then(setApproval)
      .catch(err => Alert.alert('Error', err.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color="#0066FF" />
      </SafeAreaView>
    );
  }

  if (!approval) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.errorText}>Approval not found or already resolved.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Approval Request</Text>
        <Text style={styles.requestedBy}>Requested by: {approval.requestedBy}</Text>
      </View>
      <ApprovalCard
        approvalId={approval.approvalId}
        description={approval.description}
        onResolved={() => router.back()}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
  },
  title: { fontSize: 20, fontWeight: '700', color: '#1a1a1a' },
  requestedBy: { fontSize: 14, color: '#888', marginTop: 4 },
  errorText: { fontSize: 16, color: '#888' },
});
