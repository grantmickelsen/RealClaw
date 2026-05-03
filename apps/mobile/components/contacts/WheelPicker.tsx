import { useRef, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';

const ITEM_H = 44;
const VISIBLE = 5; // must be odd — center item is selected

interface Props {
  items: string[];
  selected: string;
  onChange(val: string): void;
}

export function WheelPicker({ items, selected, onChange }: Props) {
  const scrollRef = useRef<ScrollView>(null);
  const pad = ITEM_H * Math.floor(VISIBLE / 2);
  const height = ITEM_H * VISIBLE;
  const selIdx = Math.max(0, items.indexOf(selected));

  useEffect(() => {
    if (items.length > 0) {
      scrollRef.current?.scrollTo({ y: selIdx * ITEM_H, animated: false });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // only on first mount — re-opens always re-mount

  const snap = useCallback((offset: number) => {
    const i = Math.max(0, Math.min(Math.round(offset / ITEM_H), items.length - 1));
    const val = items[i];
    if (val !== undefined) onChange(val);
  }, [items, onChange]);

  return (
    <View style={[styles.container, { height }]}>
      <View style={[styles.highlight, { top: pad }]} pointerEvents="none" />
      <ScrollView
        ref={scrollRef}
        snapToInterval={ITEM_H}
        decelerationRate="fast"
        showsVerticalScrollIndicator={false}
        onMomentumScrollEnd={e => snap(e.nativeEvent.contentOffset.y)}
        onScrollEndDrag={e => snap(e.nativeEvent.contentOffset.y)}
        scrollEventThrottle={16}
      >
        <View style={{ height: pad }} />
        {items.map(item => (
          <View key={item} style={styles.item}>
            <Text style={[styles.label, item === selected && styles.selectedLabel]}>{item}</Text>
          </View>
        ))}
        <View style={{ height: pad }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { overflow: 'hidden' },
  highlight: {
    position: 'absolute',
    left: 8, right: 8,
    height: ITEM_H,
    backgroundColor: '#EEF2FF',
    borderRadius: 10,
  },
  item: { height: ITEM_H, justifyContent: 'center', alignItems: 'center' },
  label: { fontSize: 17, color: '#9CA3AF' },
  selectedLabel: { fontSize: 17, fontWeight: '700', color: '#1a1a1a' },
});
