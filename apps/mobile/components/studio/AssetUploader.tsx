import { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Image, Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

export interface PickedAsset {
  uri: string;
  base64: string | null;
}

interface Props {
  assets: PickedAsset[];
  onChange(assets: PickedAsset[]): void;
  maxCount?: number;
  required?: boolean;
  helpText?: string;
}

export function AssetUploader({ assets, onChange, maxCount = 3, required, helpText }: Props) {
  const [picking, setPicking] = useState(false);

  async function pick() {
    if (assets.length >= maxCount || picking) return;
    setPicking(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: maxCount - assets.length,
        quality: 0.7,
        base64: true,
      });
      if (!result.canceled && result.assets.length > 0) {
        const picked = result.assets.map(a => ({ uri: a.uri, base64: a.base64 ?? null }));
        onChange([...assets, ...picked].slice(0, maxCount));
      }
    } catch {
      Alert.alert('Error', 'Could not open photo library.');
    } finally {
      setPicking(false);
    }
  }

  function remove(index: number) {
    onChange(assets.filter((_, i) => i !== index));
  }

  return (
    <View style={styles.container}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {assets.map((a, i) => (
          <View key={a.uri} style={styles.thumb}>
            <Image source={{ uri: a.uri }} style={styles.thumbImage} />
            <Pressable style={styles.removeBtn} onPress={() => remove(i)} hitSlop={8}>
              <Text style={styles.removeText}>✕</Text>
            </Pressable>
          </View>
        ))}

        {assets.length < maxCount && (
          <Pressable
            style={[styles.addBtn, picking && styles.addBtnDisabled]}
            onPress={pick}
            disabled={picking}
          >
            <Text style={styles.addIcon}>+</Text>
            <Text style={styles.addLabel}>
              {assets.length === 0 ? 'Add photos' : 'Add more'}
            </Text>
          </Pressable>
        )}
      </ScrollView>

      <Text style={[styles.hint, required && assets.length === 0 && styles.hintRequired]}>
        {helpText ?? `${assets.length}/${maxCount} photos · optional for all presets`}
        {required && assets.length === 0 ? ' *' : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 6 },
  row: { paddingHorizontal: 16, gap: 10, paddingVertical: 4 },
  thumb: {
    width: 80, height: 80,
    borderRadius: 10,
    overflow: 'hidden',
    position: 'relative',
  },
  thumbImage: { width: 80, height: 80 },
  removeBtn: {
    position: 'absolute',
    top: 4, right: 4,
    width: 20, height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  addBtn: {
    width: 80, height: 80,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#d0d0d8',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  addBtnDisabled: { opacity: 0.5 },
  addIcon: { fontSize: 22, color: '#9CA3AF' },
  addLabel: { fontSize: 11, color: '#9CA3AF', fontWeight: '500' },
  hint: { fontSize: 12, color: '#9CA3AF', paddingHorizontal: 16 },
  hintRequired: { color: '#EF4444' },
});
