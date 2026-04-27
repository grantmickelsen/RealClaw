import { View, Text, TouchableOpacity, StyleSheet, Alert, Linking } from 'react-native';
import { router } from 'expo-router';

const TEMP_COLORS: Record<string, string> = {
  hot: '#EF4444',
  warm: '#F97316',
  cold: '#3B82F6',
};

function tempLabel(score: number): { label: string; color: string } {
  if (score >= 70) return { label: 'Hot', color: TEMP_COLORS.hot };
  if (score >= 40) return { label: 'Warm', color: TEMP_COLORS.warm };
  return { label: 'Cold', color: TEMP_COLORS.cold };
}

interface Props {
  contactId: string;
  name: string;
  phone: string;
  temperatureScore?: number;
  stage?: string | null;
  budget?: string | null;
  timeline?: string | null;
  onMenuPress?: () => void;
}

export function ThreadHeader({ contactId, name, phone, temperatureScore = 0, stage, budget, timeline, onMenuPress }: Props) {
  const temp = tempLabel(temperatureScore);
  const contextParts = [
    budget && `💰 ${budget}`,
    timeline && `⏰ ${timeline}`,
  ].filter(Boolean);

  function handleBack() {
    router.back();
  }

  function handleCall() {
    void Linking.openURL(`tel:${phone}`);
  }

  function handleMenu() {
    if (onMenuPress) { onMenuPress(); return; }
    Alert.alert(name, undefined, [
      { text: 'Call', onPress: handleCall },
      { text: 'View Dossier', onPress: () => router.back() },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        <TouchableOpacity onPress={handleBack} style={styles.back} hitSlop={12}>
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
        <View style={styles.center}>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          <View style={styles.badges}>
            <View style={[styles.scoreBadge, { borderColor: temp.color }]}>
              <Text style={[styles.scoreText, { color: temp.color }]}>{temp.label} {temperatureScore}</Text>
            </View>
            {stage ? (
              <View style={styles.stagePill}>
                <Text style={styles.stageText}>{stage}</Text>
              </View>
            ) : null}
          </View>
        </View>
        <TouchableOpacity onPress={handleMenu} style={styles.menu} hitSlop={12}>
          <Text style={styles.menuIcon}>⋯</Text>
        </TouchableOpacity>
      </View>
      {contextParts.length > 0 && (
        <Text style={styles.context} numberOfLines={1}>
          {contextParts.join('  ·  ')}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    paddingTop: 56, paddingBottom: 10,
    paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: '#F3F4F6',
  },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  back: { width: 36 },
  backIcon: { fontSize: 28, color: '#6366F1', lineHeight: 32 },
  center: { flex: 1, alignItems: 'center', gap: 4 },
  name: { fontSize: 17, fontWeight: '700', color: '#111827' },
  badges: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  scoreBadge: {
    borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 2,
  },
  scoreText: { fontSize: 11, fontWeight: '700' },
  stagePill: {
    backgroundColor: '#F3F4F6', borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 2,
  },
  stageText: { fontSize: 11, color: '#6B7280', fontWeight: '500' },
  menu: { width: 36, alignItems: 'flex-end' },
  menuIcon: { fontSize: 22, color: '#6B7280' },
  context: { textAlign: 'center', fontSize: 12, color: '#9CA3AF', marginTop: 4 },
});
