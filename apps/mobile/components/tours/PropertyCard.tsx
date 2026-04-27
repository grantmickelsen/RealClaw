import { View, Text, StyleSheet, Dimensions, Image, ScrollView } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  runOnJS,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import type { PropertyResult } from '../../store/tours';

const { width: SW, height: SH } = Dimensions.get('window');
export const CARD_HEIGHT = SH * 0.62;
const SWIPE_THRESHOLD = 110;

// ─── Props ──────────────────────────────────────────────────────────────────

interface Props {
  property: PropertyResult;
  isTop: boolean;
  stackDepth: number; // 0 = top, 1 = second-from-top, etc.
  onAdd(): void;
  onSkip(): void;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function hapticLight()   { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); }
function hapticSuccess() { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); }
function hapticWarn()    { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {}); }

function scoreColor(score: number | null): string {
  if (score === null) return '#9CA3AF';
  if (score >= 80)   return '#34c759';
  if (score >= 60)   return '#FF9500';
  return '#FF6B00';
}

function formatPrice(price: number | null): string {
  if (!price) return '';
  if (price >= 1_000_000)
    return `$${(price / 1_000_000).toFixed(price % 1_000_000 === 0 ? 0 : 1)}M`;
  return `$${Math.round(price / 1000)}K`;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function PropertyCard({ property, isTop, stackDepth, onAdd, onSkip }: Props) {
  const translateX = useSharedValue(0);

  const gesture = Gesture.Pan()
    .enabled(isTop)
    .onUpdate((e) => {
      translateX.value = e.translationX;
      if (Math.abs(e.translationX) > 50) runOnJS(hapticLight)();
    })
    .onEnd((e) => {
      const vx = e.velocityX;
      const swipedRight = e.translationX > SWIPE_THRESHOLD || vx > 700;
      const swipedLeft  = e.translationX < -SWIPE_THRESHOLD || vx < -700;

      if (swipedRight) {
        runOnJS(hapticSuccess)();
        translateX.value = withTiming(SW * 1.5, { duration: 280 });
        runOnJS(onAdd)();
      } else if (swipedLeft) {
        runOnJS(hapticWarn)();
        translateX.value = withTiming(-SW * 1.5, { duration: 280 });
        runOnJS(onSkip)();
      } else {
        translateX.value = withSpring(0);
      }
    });

  const stackScale = 1 - stackDepth * 0.04;
  const stackOffsetY = stackDepth * 10;

  const cardStyle = useAnimatedStyle(() => {
    const rotate = interpolate(
      translateX.value,
      [-SW / 2, SW / 2],
      [-10, 10],
      Extrapolation.CLAMP,
    );
    return {
      transform: isTop
        ? [{ translateX: translateX.value }, { rotate: `${rotate}deg` }]
        : [{ scale: stackScale }, { translateY: stackOffsetY }],
    };
  });

  const addOverlay = useAnimatedStyle(() => ({
    opacity: isTop
      ? interpolate(translateX.value, [40, SWIPE_THRESHOLD], [0, 0.75], Extrapolation.CLAMP)
      : 0,
  }));
  const skipOverlay = useAnimatedStyle(() => ({
    opacity: isTop
      ? interpolate(translateX.value, [-40, -SWIPE_THRESHOLD], [0, 0.75], Extrapolation.CLAMP)
      : 0,
  }));

  const photoUri = property.photos[0];
  const specLine = [
    property.beds != null ? `${property.beds} bd` : null,
    property.baths != null ? `${property.baths} ba` : null,
    property.sqft != null ? `${property.sqft.toLocaleString()} sqft` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.card, cardStyle]}>
        {/* Background photo */}
        {photoUri ? (
          <Image source={{ uri: photoUri }} style={styles.photo} resizeMode="cover" />
        ) : (
          <View style={[styles.photo, styles.photoPlaceholder]}>
            <Text style={styles.placeholderIcon}>🏠</Text>
          </View>
        )}

        {/* Match score badge */}
        {property.matchScore != null && (
          <View style={[styles.scoreBadge, { backgroundColor: scoreColor(property.matchScore) }]}>
            <Text style={styles.scoreText}>{property.matchScore}</Text>
          </View>
        )}

        {/* Bottom gradient + content */}
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.82)']}
          style={styles.gradient}
        >
          {/* Criteria chips */}
          {property.matchedCriteria.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipsRow}
            >
              {property.matchedCriteria.slice(0, 5).map((c) => (
                <View key={c} style={styles.chipMatch}>
                  <Text style={styles.chipMatchText}>{c}</Text>
                </View>
              ))}
              {property.missingCriteria.slice(0, 3).map((c) => (
                <View key={c} style={styles.chipMissing}>
                  <Text style={styles.chipMissingText}>{c}</Text>
                </View>
              ))}
            </ScrollView>
          )}

          {/* Address / Price / Specs */}
          <View style={styles.info}>
            <Text style={styles.address} numberOfLines={2}>
              {property.address}
            </Text>
            {(property.price != null || specLine) && (
              <View style={styles.specRow}>
                {property.price != null && (
                  <Text style={styles.price}>{formatPrice(property.price)}</Text>
                )}
                {specLine.length > 0 && (
                  <Text style={styles.specs}>{specLine}</Text>
                )}
              </View>
            )}
            {property.dom != null && (
              <Text style={styles.dom}>{property.dom} days on market</Text>
            )}
          </View>
        </LinearGradient>

        {/* Swipe overlays */}
        <Animated.View style={[StyleSheet.absoluteFillObject, addOverlay]} pointerEvents="none">
          <LinearGradient
            colors={['transparent', 'rgba(52,199,89,0.55)']}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFillObject}
          />
          <Text style={styles.hintAdd}>ADD ✓</Text>
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFillObject, skipOverlay]} pointerEvents="none">
          <LinearGradient
            colors={['rgba(255,59,48,0.55)', 'transparent']}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFillObject}
          />
          <Text style={styles.hintSkip}>✗ SKIP</Text>
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  card: {
    width: SW - 32,
    height: CARD_HEIGHT,
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: '#1a1a1a',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 18,
    elevation: 12,
  },
  photo: {
    ...StyleSheet.absoluteFillObject,
  },
  photoPlaceholder: {
    backgroundColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderIcon: { fontSize: 56 },
  scoreBadge: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  scoreText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#fff',
  },
  gradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '65%',
    justifyContent: 'flex-end',
    paddingBottom: 20,
    paddingHorizontal: 18,
  },
  chipsRow: {
    flexDirection: 'row',
    gap: 5,
    marginBottom: 10,
    paddingHorizontal: 0,
  },
  chipMatch: {
    backgroundColor: 'rgba(52,199,89,0.25)',
    borderColor: 'rgba(52,199,89,0.5)',
    borderWidth: 1,
    borderRadius: 99,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  chipMatchText: {
    fontSize: 11,
    color: '#d1fae5',
    fontWeight: '600',
  },
  chipMissing: {
    backgroundColor: 'rgba(255,59,48,0.18)',
    borderColor: 'rgba(255,59,48,0.35)',
    borderWidth: 1,
    borderRadius: 99,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  chipMissingText: {
    fontSize: 11,
    color: '#fca5a5',
    fontWeight: '600',
    textDecorationLine: 'line-through',
  },
  info: { gap: 3 },
  address: {
    fontSize: 19,
    fontWeight: '800',
    color: '#fff',
    lineHeight: 24,
  },
  specRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  price: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  specs: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.8)',
  },
  dom: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.55)',
    marginTop: 2,
  },
  hintAdd: {
    position: 'absolute',
    top: 28,
    right: 24,
    fontSize: 24,
    fontWeight: '800',
    color: '#34c759',
    transform: [{ rotate: '-15deg' }],
  },
  hintSkip: {
    position: 'absolute',
    top: 28,
    left: 24,
    fontSize: 24,
    fontWeight: '800',
    color: '#FF3B30',
    transform: [{ rotate: '15deg' }],
  },
});
