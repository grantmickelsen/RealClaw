import { useRef, useEffect } from 'react';
import { Animated, Text, TouchableOpacity, StyleSheet } from 'react-native';
import type { ExtractedSignals } from '../../store/sms';

interface Signal {
  emoji: string;
  label: string;
  color: string;
  bg: string;
}

function getSignals(signals: ExtractedSignals): Signal[] {
  const out: Signal[] = [];
  if (signals.budget?.value) {
    out.push({ emoji: '💰', label: signals.budget.value, color: '#166534', bg: '#DCFCE7' });
  }
  if (signals.timeline?.value) {
    out.push({ emoji: '⏰', label: signals.timeline.value, color: '#92400E', bg: '#FEF3C7' });
  }
  if (signals.preferences?.length) {
    out.push({ emoji: '✨', label: signals.preferences[0]!, color: '#4338CA', bg: '#EEF2FF' });
  }
  if (signals.objections?.length) {
    out.push({ emoji: '⚠️', label: signals.objections[0]!, color: '#991B1B', bg: '#FEE2E2' });
  }
  if (signals.competitorMentions?.length) {
    out.push({ emoji: '👥', label: signals.competitorMentions[0]!, color: '#374151', bg: '#F3F4F6' });
  }
  return out;
}

interface Props {
  signals: ExtractedSignals;
  onPress?: (signal: Signal) => void;
}

export function SignalChip({ signals, onPress }: Props) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.85)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, tension: 200, friction: 20, useNativeDriver: true }),
    ]).start();
  }, []);

  const chips = getSignals(signals);
  if (!chips.length) return null;

  return (
    <Animated.View style={[styles.row, { opacity, transform: [{ scale }] }]}>
      {chips.map((chip, i) => (
        <TouchableOpacity
          key={i}
          style={[styles.chip, { backgroundColor: chip.bg }]}
          onPress={() => onPress?.(chip)}
          activeOpacity={0.7}
        >
          <Text style={styles.emoji}>{chip.emoji}</Text>
          <Text style={[styles.label, { color: chip.color }]} numberOfLines={1}>
            {chip.label}
          </Text>
        </TouchableOpacity>
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4, marginLeft: 44 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20,
  },
  emoji: { fontSize: 11 },
  label: { fontSize: 11, fontWeight: '600', maxWidth: 120 },
});
