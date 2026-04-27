import { View, Text, StyleSheet, ScrollView } from 'react-native';
import type { ShowingStop } from '../../store/tours';

interface Props {
  stops: ShowingStop[];
  currentIndex: number;
}

export function StopProgress({ stops, currentIndex }: Props) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {stops.map((stop, i) => {
        const isDone = i < currentIndex;
        const isCurrent = i === currentIndex;

        return (
          <View key={stop.id} style={styles.stepWrapper}>
            <View
              style={[
                styles.dot,
                isDone && styles.dotDone,
                isCurrent && styles.dotCurrent,
              ]}
            >
              {isDone ? (
                <Text style={styles.checkmark}>✓</Text>
              ) : (
                <Text style={[styles.num, isCurrent && styles.numCurrent]}>
                  {i + 1}
                </Text>
              )}
            </View>
            {i < stops.length - 1 && (
              <View style={[styles.connector, isDone && styles.connectorDone]} />
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  stepWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F9FAFB',
  },
  dotDone: {
    backgroundColor: '#0066FF',
    borderColor: '#0066FF',
  },
  dotCurrent: {
    borderColor: '#0066FF',
    borderWidth: 2.5,
    backgroundColor: '#EFF6FF',
  },
  num: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9CA3AF',
  },
  numCurrent: {
    color: '#0066FF',
  },
  checkmark: {
    fontSize: 12,
    fontWeight: '800',
    color: '#fff',
  },
  connector: {
    width: 20,
    height: 2,
    backgroundColor: '#D1D5DB',
    marginHorizontal: 2,
  },
  connectorDone: {
    backgroundColor: '#0066FF',
  },
});
