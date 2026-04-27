import { View, Text, StyleSheet, TouchableOpacity, Alert, ActionSheetIOS, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { DealMilestone, MilestoneStatus } from '../../store/deals';

interface Props {
  milestones: DealMilestone[];
  onComplete(milestoneId: string): void;
  onWaive(milestoneId: string): void;
}

const STATUS_CONFIG: Record<MilestoneStatus, { color: string; bg: string; icon: keyof typeof Ionicons.glyphMap }> = {
  complete:    { color: '#10B981', bg: '#D1FAE5', icon: 'checkmark-circle' },
  overdue:     { color: '#EF4444', bg: '#FEE2E2', icon: 'alert-circle' },
  in_progress: { color: '#F59E0B', bg: '#FEF3C7', icon: 'time-outline' },
  waived:      { color: '#9CA3AF', bg: '#F3F4F6', icon: 'remove-circle-outline' },
  pending:     { color: '#6B7280', bg: '#F9FAFB', icon: 'ellipse-outline' },
};

function formatDate(date: string | null): string {
  if (!date) return '';
  return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function MilestoneNode({
  milestone,
  isLast,
  onAction,
}: {
  milestone: DealMilestone;
  isLast: boolean;
  onAction(): void;
}) {
  const cfg = STATUS_CONFIG[milestone.status];
  const isDone = milestone.status === 'complete' || milestone.status === 'waived';

  return (
    <View style={styles.nodeRow}>
      {/* Track line */}
      <View style={styles.trackCol}>
        <View style={[styles.dot, { backgroundColor: cfg.bg, borderColor: cfg.color }]}>
          <Ionicons name={cfg.icon} size={16} color={cfg.color} />
        </View>
        {!isLast && <View style={[styles.line, { backgroundColor: isDone ? '#10B981' : '#E5E7EB' }]} />}
      </View>

      {/* Content */}
      <TouchableOpacity
        style={styles.nodeContent}
        onPress={() => { if (!isDone) onAction(); }}
        activeOpacity={isDone ? 1 : 0.7}
        disabled={isDone}
      >
        <View style={styles.nodeTop}>
          <Text style={[styles.nodeLabel, isDone && styles.nodeLabelDone]}>{milestone.label}</Text>
          {milestone.is_blocking && !isDone && (
            <Ionicons name="lock-closed-outline" size={12} color="#9CA3AF" style={{ marginLeft: 4 }} />
          )}
        </View>
        <View style={styles.nodeMeta}>
          {milestone.deadline && (
            <Text style={[styles.nodeDate, milestone.status === 'overdue' && styles.nodeDateOverdue]}>
              {milestone.status === 'complete'
                ? `Done ${formatDate(milestone.completed_at)}`
                : milestone.status === 'waived'
                ? `Waived ${formatDate(milestone.waived_at)}`
                : `Due ${formatDate(milestone.deadline)}`}
            </Text>
          )}
          {!isDone && (
            <View style={[styles.statusBadge, { backgroundColor: cfg.bg }]}>
              <Text style={[styles.statusText, { color: cfg.color }]}>
                {milestone.status === 'overdue' ? 'Overdue' : milestone.status === 'in_progress' ? 'In Progress' : 'Pending'}
              </Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    </View>
  );
}

export function MilestoneTrack({ milestones, onComplete, onWaive }: Props) {
  const handleAction = (milestone: DealMilestone) => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: milestone.label,
          options: ['Mark Complete', 'Waive Contingency', 'Cancel'],
          destructiveButtonIndex: 1,
          cancelButtonIndex: 2,
        },
        i => {
          if (i === 0) onComplete(milestone.id);
          if (i === 1) onWaive(milestone.id);
        },
      );
    } else {
      Alert.alert(milestone.label, undefined, [
        { text: 'Mark Complete', onPress: () => onComplete(milestone.id) },
        { text: 'Waive Contingency', style: 'destructive', onPress: () => onWaive(milestone.id) },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  };

  return (
    <View style={styles.container}>
      {milestones.map((m, i) => (
        <MilestoneNode
          key={m.id}
          milestone={m}
          isLast={i === milestones.length - 1}
          onAction={() => handleAction(m)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 16, paddingTop: 8 },
  nodeRow: { flexDirection: 'row', alignItems: 'flex-start' },
  trackCol: { alignItems: 'center', width: 32, marginRight: 12 },
  dot: {
    width: 28, height: 28, borderRadius: 14,
    borderWidth: 1.5, alignItems: 'center', justifyContent: 'center',
  },
  line: { width: 2, flex: 1, minHeight: 16 },
  nodeContent: { flex: 1, paddingBottom: 16, paddingTop: 4 },
  nodeTop: { flexDirection: 'row', alignItems: 'center' },
  nodeLabel: { fontSize: 15, fontWeight: '600', color: '#111827' },
  nodeLabelDone: { color: '#9CA3AF' },
  nodeMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3 },
  nodeDate: { fontSize: 12, color: '#6B7280' },
  nodeDateOverdue: { color: '#EF4444', fontWeight: '600' },
  statusBadge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  statusText: { fontSize: 11, fontWeight: '600' },
});
