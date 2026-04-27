import { TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import type { ContactCard } from '../../store/contacts';

interface Props {
  contact: ContactCard;
  onPress(): void;
  variant: 'hot' | 'warm' | 'cold';
}

function nameInitials(name: string | null, fallback: string): string {
  if (!name) return fallback.slice(0, 2).toUpperCase();
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function displayName(contact: ContactCard): string {
  return contact.name ?? contact.contactType.replace(/_/g, ' ');
}

const BORDER_COLORS = { hot: '#EF4444', warm: '#F59E0B', cold: '#9CA3AF' };

export function TemperatureCard({ contact, onPress, variant }: Props) {
  function handlePress() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onPress();
  }

  if (variant === 'cold') {
    return (
      <TouchableOpacity style={styles.chip} onPress={handlePress} activeOpacity={0.85}>
        <View style={styles.chipAvatar}>
          <Text style={styles.chipAvatarText}>{nameInitials(contact.name, contact.id)}</Text>
        </View>
        <Text style={styles.chipLabel} numberOfLines={1}>{displayName(contact)}</Text>
      </TouchableOpacity>
    );
  }

  const borderColor = BORDER_COLORS[variant];

  return (
    <TouchableOpacity
      style={[styles.card, variant === 'warm' && styles.cardWarm, { borderLeftColor: borderColor }]}
      onPress={handlePress}
      activeOpacity={0.85}
    >
      <View style={styles.cardRow}>
        <Text style={styles.contactType}>{contact.contactType.replace(/_/g, ' ').toUpperCase()}</Text>
        <View style={[styles.scoreBadge, { backgroundColor: borderColor }]}>
          <Text style={styles.scoreText}>{Math.round(contact.temperatureScore)}</Text>
        </View>
      </View>
      <Text style={variant === 'hot' ? styles.nameHot : styles.nameWarm} numberOfLines={1}>
        {displayName(contact)}
      </Text>
      <Text style={styles.nextAction} numberOfLines={variant === 'hot' ? 2 : 1}>
        {contact.nextAction}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    borderLeftWidth: 4,
    gap: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07,
    shadowRadius: 6,
    elevation: 2,
  },
  cardWarm: {
    flex: 1,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  contactType: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6B7280',
    letterSpacing: 0.5,
    flex: 1,
  },
  scoreBadge: {
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  scoreText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
  },
  nameHot: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
  },
  nameWarm: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  nextAction: {
    fontSize: 13,
    color: '#6B7280',
    lineHeight: 19,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fff',
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  chipAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipAvatarText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6B7280',
  },
  chipLabel: {
    fontSize: 13,
    color: '#374151',
    fontWeight: '500',
    maxWidth: 110,
  },
});
