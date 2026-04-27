import { View, Text, StyleSheet } from 'react-native';
import { PropertyCard, CARD_HEIGHT } from './PropertyCard';
import type { PropertyResult } from '../../store/tours';

interface Props {
  queue: PropertyResult[];
  currentIndex: number;
  contactName: string | null;
  onAdd(id: string): void;
  onSkip(id: string): void;
}

const VISIBLE_CARDS = 3;

export function PropertySwipeStack({
  queue,
  currentIndex,
  contactName,
  onAdd,
  onSkip,
}: Props) {
  const remaining = queue.length - currentIndex;

  if (remaining === 0) {
    return (
      <View style={styles.emptyWrapper}>
        <Text style={styles.emptyIcon}>🏡</Text>
        <Text style={styles.emptyTitle}>All properties reviewed</Text>
        <Text style={styles.emptySubtitle}>
          {contactName
            ? `Nothing more queued for ${contactName}.`
            : 'Nothing more in the queue.'}
          {'\n'}New listings will appear as they're matched.
        </Text>
      </View>
    );
  }

  // Render up to VISIBLE_CARDS cards (top card last so it paints on top)
  const sliceEnd = Math.min(currentIndex + VISIBLE_CARDS, queue.length);
  const visibleSlice = queue.slice(currentIndex, sliceEnd);

  return (
    <View style={[styles.stack, { height: CARD_HEIGHT }]}>
      {visibleSlice.map((property, relIdx) => {
        const isTop = relIdx === 0;
        return (
          <View key={property.id} style={[styles.cardWrapper, { zIndex: VISIBLE_CARDS - relIdx }]}>
            <PropertyCard
              property={property}
              isTop={isTop}
              stackDepth={relIdx}
              onAdd={() => onAdd(property.id)}
              onSkip={() => onSkip(property.id)}
            />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardWrapper: {
    position: 'absolute',
  },
  emptyWrapper: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 12,
  },
  emptyIcon: {
    fontSize: 52,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1a1a1a',
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#9CA3AF',
    textAlign: 'center',
    lineHeight: 22,
  },
});
