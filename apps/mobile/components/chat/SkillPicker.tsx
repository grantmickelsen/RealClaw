import { useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Animated,
  Keyboard,
  useWindowDimensions,
} from 'react-native';
import { filterSkills, type Skill } from '../../constants/skills';

const MAX_VISIBLE = 5;
const ROW_HEIGHT = 60;

interface Props {
  query: string;           // text after the "/" — used to filter
  visible: boolean;
  onSelect(skill: Skill): void;
  onDismiss(): void;
  bottomOffset: number;    // height above the input bar (keyboard + bar height)
}

export function SkillPicker({ query, visible, onSelect, onDismiss, bottomOffset }: Props) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(12)).current;
  const { width } = useWindowDimensions();

  useEffect(() => {
    Animated.parallel([
      Animated.spring(opacity, {
        toValue: visible ? 1 : 0,
        useNativeDriver: true,
        speed: 28,
        bounciness: 0,
      }),
      Animated.spring(translateY, {
        toValue: visible ? 0 : 12,
        useNativeDriver: true,
        speed: 28,
        bounciness: 0,
      }),
    ]).start();
  }, [visible]);

  const skills = filterSkills(query);

  if (!visible && opacity._value === 0) return null;

  const listHeight = Math.min(skills.length, MAX_VISIBLE) * ROW_HEIGHT;

  return (
    <>
      {/* Scrim — dismiss on tap outside */}
      {visible && (
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onDismiss}
        />
      )}

      <Animated.View
        style={[
          styles.container,
          { bottom: bottomOffset, width, opacity, transform: [{ translateY }] },
        ]}
        pointerEvents={visible ? 'box-none' : 'none'}
      >
        <View style={[styles.sheet, { maxHeight: listHeight + 8 }]}>
          <FlatList
            data={skills}
            keyExtractor={item => item.command}
            keyboardShouldPersistTaps="always"
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.row}
                activeOpacity={0.7}
                onPress={() => {
                  Keyboard.dismiss();
                  onSelect(item);
                }}
              >
                <Text style={styles.icon}>{item.icon}</Text>
                <View style={styles.textBlock}>
                  <Text style={styles.label} numberOfLines={1}>
                    <Text style={styles.slash}>/</Text>
                    {item.command}
                    {'  '}
                    <Text style={styles.labelName}>{item.label}</Text>
                  </Text>
                  <Text style={styles.description} numberOfLines={1}>
                    {item.description}
                  </Text>
                </View>
              </TouchableOpacity>
            )}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            ListEmptyComponent={
              <View style={styles.emptyRow}>
                <Text style={styles.emptyText}>No matching skills</Text>
              </View>
            }
          />
        </View>
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    paddingHorizontal: 8,
    zIndex: 100,
  },
  sheet: {
    backgroundColor: '#fff',
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.10,
    shadowRadius: 12,
    elevation: 8,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.08)',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    height: ROW_HEIGHT,
  },
  icon: {
    fontSize: 22,
    width: 36,
    textAlign: 'center',
  },
  textBlock: {
    flex: 1,
    marginLeft: 8,
  },
  slash: {
    color: '#0066FF',
    fontWeight: '700',
    fontSize: 14,
    fontFamily: 'Menlo',
  },
  label: {
    fontSize: 14,
    color: '#0066FF',
    fontWeight: '600',
    fontFamily: 'Menlo',
  },
  labelName: {
    fontSize: 13,
    color: '#1a1a1a',
    fontWeight: '500',
    fontFamily: undefined,
  },
  description: {
    fontSize: 12,
    color: '#888',
    marginTop: 1,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(0,0,0,0.06)',
    marginLeft: 58,
  },
  emptyRow: {
    height: ROW_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: '#aaa',
    fontSize: 13,
  },
});
