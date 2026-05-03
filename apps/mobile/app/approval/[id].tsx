import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  Pressable,
  Alert,
  ActivityIndicator,
  Share,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withSequence,
  withDelay,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { authedFetch } from '../../lib/api';
import { useApprovalStore } from '../../store/approvals';
import type { ApprovalItem } from '../../store/approvals';
import { useBriefingStore } from '../../store/briefing';
import { SwipeCard } from '../../components/chat/SwipeCard';
import { EditSheet } from '../../components/chat/EditSheet';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const STACK_VISIBLE = 3;

interface ApprovalResponse {
  approvalId: string;
  items: ApprovalItem[];
  expiresAt: string;
  status: string;
}

export default function ApprovalScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [editItem, setEditItem] = useState<ApprovalItem | null>(null);

  const store = useApprovalStore();
  const progressWidth = useSharedValue(0);
  const doneScale = useSharedValue(0);

  const totalItems = store.items.length;
  const remaining = totalItems - store.currentIndex;
  const progressFraction = totalItems > 0 ? store.currentIndex / totalItems : 0;

  // Animate progress bar
  useEffect(() => {
    progressWidth.value = withSpring(progressFraction, { damping: 18, stiffness: 120 });
  }, [progressFraction, progressWidth]);

  const progressStyle = useAnimatedStyle(() => ({
    width: `${progressWidth.value * 100}%` as unknown as number,
  }));

  // Fetch approval details on mount
  useEffect(() => {
    if (!id) return;
    authedFetch(`/v1/approvals/${id}`)
      .then(res => {
        if (!res.ok) throw new Error('Approval not found or already resolved');
        return res.json() as Promise<ApprovalResponse>;
      })
      .then(data => {
        store.setCarousel(data.approvalId, data.items);
      })
      .catch(err => {
        Alert.alert('Error', (err as Error).message);
        router.back();
      })
      .finally(() => setLoading(false));

    return () => { store.reset(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Submit all collected decisions
  const submitDecisions = useCallback(async (decisions: typeof store.decisions) => {
    if (!store.approvalId) return;
    setSubmitting(true);
    try {
      await authedFetch(`/v1/approvals/${store.approvalId}`, {
        method: 'POST',
        body: JSON.stringify({
          type: 'APPROVAL_RESPONSE',
          approvalId: store.approvalId,
          decisions,
        }),
      });
      // Double success haptic
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}), 150);
      // Animate done checkmark in
      doneScale.value = withSequence(
        withTiming(1.15, { duration: 200 }),
        withSpring(1, { damping: 12 }),
      );
      setDone(true);
      setTimeout(() => {
        const { pendingApprovalIds, shiftPendingApproval } = useBriefingStore.getState();
        if (pendingApprovalIds.length > 0) {
          const nextId = pendingApprovalIds[0];
          shiftPendingApproval();
          router.replace(`/approval/${nextId}`);
        } else {
          router.back();
        }
      }, 1400);
    } catch (err) {
      Alert.alert('Error', (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }, [store.approvalId, doneScale]);

  // Check completion after each decision advance
  useEffect(() => {
    if (!loading && store.items.length > 0 && store.isComplete()) {
      submitDecisions(store.decisions);
    }
  }, [store.currentIndex, loading, store, submitDecisions]);

  const handleApprove = useCallback(async () => {
    const item = store.items[store.currentIndex];
    if (!item) return;

    if (item.actionType === 'post_social') {
      const content = item.fullContent ?? item.preview;
      await Share.share({ message: content, title: 'Share Post' }).catch(() => {});
      store.recordDecision({ index: item.index, decision: 'shared' });
    } else {
      store.recordDecision({ index: item.index, decision: 'approve' });
    }

    store.advance();
  }, [store]);

  const handleReject = useCallback(() => {
    const item = store.items[store.currentIndex];
    if (!item) return;
    store.recordDecision({ index: item.index, decision: 'cancel' });
    store.advance();
  }, [store]);

  const handleEdit = useCallback(() => {
    const item = store.items[store.currentIndex];
    if (item) setEditItem(item);
  }, [store]);

  const handleEditSave = useCallback((editInstructions: string) => {
    if (!editItem) return;
    store.recordDecision({ index: editItem.index, decision: 'edit', editInstructions });
    store.advance();
    setEditItem(null);
  }, [editItem, store]);

  function handleSkipAll() {
    Alert.alert('Skip remaining?', 'All remaining actions will be cancelled.', [
      { text: 'No', style: 'cancel' },
      {
        text: 'Skip all', style: 'destructive', onPress: () => {
          const remaining = store.items.slice(store.currentIndex);
          for (const item of remaining) {
            store.recordDecision({ index: item.index, decision: 'cancel' });
          }
          submitDecisions([
            ...store.decisions,
            ...remaining.map(i => ({ index: i.index, decision: 'cancel' as const })),
          ]);
        },
      },
    ]);
  }

  const doneStyle = useAnimatedStyle(() => ({
    transform: [{ scale: doneScale.value }],
    opacity: doneScale.value,
  }));

  // ─── Loading ───
  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color="#0066FF" />
      </SafeAreaView>
    );
  }

  // ─── Done state ───
  if (done) {
    return (
      <SafeAreaView style={[styles.center, styles.darkBg]}>
        <Animated.View style={[styles.doneContainer, doneStyle]}>
          <Text style={styles.doneEmoji}>✓</Text>
          <Text style={styles.doneText}>All done!</Text>
        </Animated.View>
      </SafeAreaView>
    );
  }

  // Visible card stack — top 3 from currentIndex
  const visibleItems = store.items.slice(store.currentIndex, store.currentIndex + STACK_VISIBLE);

  return (
    <SafeAreaView style={[styles.container, styles.darkBg]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.closeBtn}>
          <Text style={styles.closeBtnText}>✕ Close</Text>
        </Pressable>

        <View style={styles.progressContainer}>
          <View style={styles.progressTrack}>
            <Animated.View style={[styles.progressFill, progressStyle]} />
          </View>
          <Text style={styles.progressLabel}>
            {store.currentIndex} / {totalItems}
          </Text>
        </View>

        {remaining > 0 ? (
          <Pressable onPress={handleSkipAll} style={styles.skipBtn}>
            <Text style={styles.skipBtnText}>Skip all</Text>
          </Pressable>
        ) : (
          <View style={styles.skipBtn} />
        )}
      </View>

      {/* Card Stack */}
      <View style={styles.stackContainer}>
        {visibleItems.length === 0 ? (
          submitting ? (
            <ActivityIndicator size="large" color="#fff" />
          ) : null
        ) : (
          [...visibleItems].reverse().map((item, reverseIdx) => {
            const stackDepth = visibleItems.length - 1 - reverseIdx;
            return (
              <View key={item.taskResultId} style={styles.cardWrapper}>
                <SwipeCard
                  item={item}
                  isTop={stackDepth === 0}
                  stackDepth={stackDepth}
                  onApprove={handleApprove}
                  onReject={handleReject}
                  onEdit={handleEdit}
                />
              </View>
            );
          })
        )}
      </View>

      {/* Gesture hint labels */}
      {visibleItems.length > 0 && (
        <View style={styles.hintBar}>
          <Text style={styles.hintLeft}>← REJECT</Text>
          <Text style={styles.hintUp}>↑ EDIT</Text>
          <Text style={styles.hintRight}>
            {store.items[store.currentIndex]?.actionType === 'post_social' ? 'SHARE →' : 'APPROVE →'}
          </Text>
        </View>
      )}

      {/* Edit sheet */}
      <EditSheet
        visible={editItem !== null}
        item={editItem}
        onSave={handleEditSave}
        onCancel={() => setEditItem(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  darkBg: { backgroundColor: '#0f0f14' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  closeBtn: { padding: 4, minWidth: 70 },
  closeBtnText: { color: '#9CA3AF', fontSize: 14, fontWeight: '500' },
  skipBtn: { padding: 4, minWidth: 70, alignItems: 'flex-end' },
  skipBtnText: { color: '#6366f1', fontSize: 14, fontWeight: '500' },

  progressContainer: {
    flex: 1,
    gap: 4,
    alignItems: 'center',
  },
  progressTrack: {
    width: '100%',
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 999,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#0066FF',
    borderRadius: 999,
  },
  progressLabel: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    fontWeight: '500',
    fontFamily: 'ui-rounded',
  },

  stackContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  cardWrapper: {
    position: 'absolute',
  },

  hintBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 28,
    paddingBottom: 24,
    paddingTop: 8,
  },
  hintLeft: { color: 'rgba(255,59,48,0.5)', fontSize: 13, fontWeight: '600', fontFamily: 'ui-rounded' },
  hintUp:   { color: 'rgba(99,102,241,0.5)', fontSize: 13, fontWeight: '600', fontFamily: 'ui-rounded' },
  hintRight:{ color: 'rgba(52,199,89,0.5)', fontSize: 13, fontWeight: '600', fontFamily: 'ui-rounded' },

  doneContainer: { alignItems: 'center', gap: 12 },
  doneEmoji: { fontSize: 64, color: '#34c759' },
  doneText: {
    fontSize: 28,
    fontWeight: '800',
    color: '#fff',
    fontFamily: 'ui-rounded',
  },
});
