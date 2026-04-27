import { useRef, useEffect, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, type ListRenderItemInfo } from 'react-native';

const ITEM_H = 44;
const VISIBLE = 5; // must be odd — center item is selected

interface Props {
  items: string[];
  selected: string;
  onChange(val: string): void;
}

export function WheelPicker({ items, selected, onChange }: Props) {
  const listRef = useRef<FlatList<string>>(null);
  const pad = ITEM_H * Math.floor(VISIBLE / 2);
  const height = ITEM_H * VISIBLE;
  const selIdx = Math.max(0, items.indexOf(selected));

  useEffect(() => {
    if (items.length > 0) {
      listRef.current?.scrollToOffset({ offset: selIdx * ITEM_H, animated: false });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // only on first mount — re-opens always re-mount

  const snap = useCallback((offset: number) => {
    const i = Math.max(0, Math.min(Math.round(offset / ITEM_H), items.length - 1));
    listRef.current?.scrollToOffset({ offset: i * ITEM_H, animated: true });
    const val = items[i];
    if (val !== undefined) onChange(val);
  }, [items, onChange]);

  const renderItem = useCallback(({ item }: ListRenderItemInfo<string>) => (
    <View style={styles.item}>
      <Text style={[styles.label, item === selected && styles.selectedLabel]}>{item}</Text>
    </View>
  ), [selected]);

  return (
    <View style={[styles.container, { height }]}>
      <View style={[styles.highlight, { top: pad }]} pointerEvents="none" />
      <FlatList
        ref={listRef}
        data={items}
        keyExtractor={i => i}
        renderItem={renderItem}
        snapToInterval={ITEM_H}
        decelerationRate="fast"
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={<View style={{ height: pad }} />}
        ListFooterComponent={<View style={{ height: pad }} />}
        onMomentumScrollEnd={e => snap(e.nativeEvent.contentOffset.y)}
        onScrollEndDrag={e => snap(e.nativeEvent.contentOffset.y)}
        getItemLayout={(_, index) => ({ length: ITEM_H, offset: ITEM_H * index, index })}
      />
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
