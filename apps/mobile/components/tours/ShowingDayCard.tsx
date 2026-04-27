import { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ShowingDay, DayStatus, ShowingStop } from '../../store/tours';

// ─── Status config ──────────────────────────────────────────────────────────

interface StatusMeta {
  label: string;
  color: string;
  bg: string;
}

const STATUS_META: Record<DayStatus, StatusMeta> = {
  draft:              { label: 'Draft',          color: '#6B7280', bg: '#F3F4F6' },
  proposed_to_client: { label: 'Pending Client', color: '#D97706', bg: '#FEF3C7' },
  confirmed:          { label: 'Confirmed',      color: '#0E7490', bg: '#CFFAFE' },
  in_progress:        { label: 'In Progress',    color: '#1D4ED8', bg: '#DBEAFE' },
  completed:          { label: 'Completed',      color: '#15803D', bg: '#DCFCE7' },
  cancelled:          { label: 'Cancelled',      color: '#9CA3AF', bg: '#F3F4F6' },
};

// ─── Props ──────────────────────────────────────────────────────────────────

interface Props {
  day: ShowingDay;
  stops?: ShowingStop[];
  onPress(): void;
  onLiveTap?(): void;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function ShowingDayCard({ day, stops, onPress, onLiveTap }: Props) {
  const [expanded, setExpanded] = useState(false);
  const meta = STATUS_META[day.status];

  const date = new Date(day.proposedDate + 'T00:00:00');
  const dayNum = date.toLocaleDateString('en-US', { day: 'numeric' });
  const monthAbbr = date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
  const weekday = date.toLocaleDateString('en-US', { weekday: 'short' });

  const timeRange =
    day.proposedStartTime && day.proposedEndTime
      ? `${day.proposedStartTime} – ${day.proposedEndTime}`
      : day.proposedStartTime ?? null;

  function handlePress() {
    if (day.status === 'in_progress' && onLiveTap) {
      onLiveTap();
    } else {
      setExpanded((v) => !v);
      onPress();
    }
  }

  return (
    <TouchableOpacity
      style={[styles.card, expanded && styles.cardExpanded]}
      onPress={handlePress}
      activeOpacity={0.85}
    >
      {/* Live pulse strip */}
      {day.status === 'in_progress' && <View style={styles.liveStrip} />}

      <View style={styles.row}>
        {/* Date block */}
        <View style={styles.dateBlock}>
          <Text style={styles.monthAbbr}>{monthAbbr}</Text>
          <Text style={styles.dayNum}>{dayNum}</Text>
          <Text style={styles.weekday}>{weekday}</Text>
        </View>

        {/* Main info */}
        <View style={styles.info}>
          <View style={styles.nameRow}>
            <Text style={styles.contactName} numberOfLines={1}>
              {day.contactName ?? 'Unknown Contact'}
            </Text>
            <View style={[styles.statusChip, { backgroundColor: meta.bg }]}>
              <Text style={[styles.statusText, { color: meta.color }]}>
                {meta.label}
              </Text>
            </View>
          </View>

          <View style={styles.detailRow}>
            <Ionicons name="home-outline" size={12} color="#6B7280" />
            <Text style={styles.detailText}>
              {day.propertyCount} {day.propertyCount === 1 ? 'stop' : 'stops'}
            </Text>
            {timeRange && (
              <>
                <Text style={styles.dot}> · </Text>
                <Ionicons name="time-outline" size={12} color="#6B7280" />
                <Text style={styles.detailText}> {timeRange}</Text>
              </>
            )}
          </View>

          {/* Photo strip */}
          {day.photos.length > 0 && (
            <View style={styles.photoStrip}>
              {day.photos.slice(0, 3).map((uri, i) => (
                <Image
                  key={i}
                  source={{ uri }}
                  style={styles.thumbnail}
                />
              ))}
            </View>
          )}
        </View>

        {/* Chevron */}
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={16}
          color="#9CA3AF"
          style={styles.chevron}
        />
      </View>

      {/* Expanded: stop list */}
      {expanded && stops && stops.length > 0 && (
        <View style={styles.stopList}>
          {stops.map((stop, i) => (
            <View key={stop.id} style={styles.stopRow}>
              <View style={[styles.accessDot, accessDotStyle(stop.accessStatus)]} />
              <Text style={styles.stopNum}>{i + 1}.</Text>
              <Text style={styles.stopAddr} numberOfLines={1}>
                {stop.address}
              </Text>
              {stop.scheduledTime && (
                <Text style={styles.stopTime}>
                  {new Date(stop.scheduledTime).toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true,
                  })}
                </Text>
              )}
            </View>
          ))}
        </View>
      )}
    </TouchableOpacity>
  );
}

function accessDotStyle(status: ShowingStop['accessStatus']): object {
  switch (status) {
    case 'confirmed':    return { backgroundColor: '#34c759' };
    case 'not_needed':   return { backgroundColor: '#34c759' };
    case 'negotiating':  return { backgroundColor: '#FF9500' };
    case 'failed':       return { backgroundColor: '#FF3B30' };
    default:             return { backgroundColor: '#D1D5DB' };
  }
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    marginHorizontal: 12,
    marginVertical: 5,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 3,
  },
  cardExpanded: {
    shadowOpacity: 0.12,
    shadowRadius: 12,
  },
  liveStrip: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: '#0066FF',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
  },
  dateBlock: {
    width: 48,
    alignItems: 'center',
    marginRight: 14,
  },
  monthAbbr: {
    fontSize: 10,
    fontWeight: '700',
    color: '#0066FF',
    letterSpacing: 0.5,
  },
  dayNum: {
    fontSize: 26,
    fontWeight: '800',
    color: '#1a1a1a',
    lineHeight: 30,
  },
  weekday: {
    fontSize: 10,
    color: '#9CA3AF',
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  info: {
    flex: 1,
    gap: 4,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  contactName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1a1a1a',
    flexShrink: 1,
  },
  statusChip: {
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  detailText: {
    fontSize: 12,
    color: '#6B7280',
    marginLeft: 3,
  },
  dot: { color: '#9CA3AF', fontSize: 12 },
  photoStrip: {
    flexDirection: 'row',
    gap: 4,
    marginTop: 6,
  },
  thumbnail: {
    width: 44,
    height: 33,
    borderRadius: 6,
    backgroundColor: '#F3F4F6',
  },
  chevron: {
    marginLeft: 8,
  },
  stopList: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#F3F4F6',
    paddingHorizontal: 14,
    paddingBottom: 12,
    paddingTop: 8,
    gap: 6,
  },
  stopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  accessDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  stopNum: {
    fontSize: 12,
    color: '#9CA3AF',
    fontWeight: '600',
    width: 16,
  },
  stopAddr: {
    flex: 1,
    fontSize: 13,
    color: '#374151',
  },
  stopTime: {
    fontSize: 12,
    color: '#6B7280',
    fontVariant: ['tabular-nums'],
  },
});
