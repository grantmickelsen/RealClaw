import { useRef } from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  runOnJS,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import * as LocalAuthentication from 'expo-local-authentication';
import type { ApprovalItem, ApprovalActionType } from '../../store/approvals';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = SCREEN_WIDTH - 48;
const SWIPE_X_THRESHOLD = 120;
const SWIPE_Y_THRESHOLD = -80;
const HINT_APPEAR_AT = 40;

// ─── Per-category design tokens ───

interface CategoryMeta {
  icon: string;
  label: string;
  accent: string;
  highStakes?: boolean;
}

const CATEGORY_META: Record<ApprovalActionType, CategoryMeta> = {
  send_email:       { icon: '📧', label: 'Send Email',       accent: '#0066FF' },
  send_sms:         { icon: '💬', label: 'Send SMS',         accent: '#34c759' },
  send_linkedin_dm: { icon: '💼', label: 'LinkedIn DM',      accent: '#0A66C2' },
  modify_calendar:  { icon: '📅', label: 'Calendar Event',   accent: '#FF6B00' },
  post_social:      { icon: '📱', label: 'Social Post',      accent: '#8B5CF6' },
  send_document:    { icon: '📄', label: 'Send Document',    accent: '#6B7280' },
  financial_action: { icon: '💰', label: 'Financial Action', accent: '#EF4444', highStakes: true },
};

// ─── Props ───

interface Props {
  item: ApprovalItem;
  isTop: boolean;
  stackDepth: number; // 0 = top, 1 = second, 2 = third
  onApprove(): void;
  onReject(): void;
  onEdit(): void;
}

// ─── Haptics helpers (run on JS thread) ───

function hapticLight() { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); }
function hapticHeavy() { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {}); }
function hapticSuccess() { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); }
function hapticWarning() { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {}); }
function hapticMedium() { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); }

// ─── Component ───

export function SwipeCard({ item, isTop, stackDepth, onApprove, onReject, onEdit }: Props) {
  const meta = CATEGORY_META[item.actionType] ?? { icon: '⚡', label: item.actionType, accent: '#0066FF' };
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const hintFired = useRef(false);

  async function attemptApprove() {
    try {
      const bioAvailable = await LocalAuthentication.hasHardwareAsync();
      if (bioAvailable) {
        const result = await LocalAuthentication.authenticateAsync({ promptMessage: 'Confirm approval' });
        if (!result.success) {
          translateX.value = withSpring(0);
          translateY.value = withSpring(0);
          return;
        }
      }
    } catch {
      // Biometric auth unavailable or failed — proceed without it
    }
    hapticSuccess();
    onApprove();
  }

  const gesture = Gesture.Pan()
    .enabled(isTop)
    .onUpdate(e => {
      translateX.value = e.translationX;
      translateY.value = e.translationY;

      // Fire light haptic once when crossing hint threshold
      if (!hintFired.current && (Math.abs(e.translationX) > HINT_APPEAR_AT || e.translationY < -HINT_APPEAR_AT)) {
        runOnJS(hapticLight)();
        hintFired.current = true;
      }
      if (hintFired.current && Math.abs(e.translationX) < HINT_APPEAR_AT && e.translationY > -HINT_APPEAR_AT) {
        hintFired.current = false;
      }
    })
    .onEnd(e => {
      const vx = e.velocityX;
      const vy = e.velocityY;
      const exceedsRight = e.translationX > SWIPE_X_THRESHOLD || vx > 800;
      const exceedsLeft = e.translationX < -SWIPE_X_THRESHOLD || vx < -800;
      const exceedsUp = e.translationY < SWIPE_Y_THRESHOLD || vy < -800;

      if (exceedsRight) {
        runOnJS(hapticHeavy)();
        translateX.value = withTiming(SCREEN_WIDTH * 1.5, { duration: 280 });
        runOnJS(attemptApprove)();
      } else if (exceedsLeft) {
        runOnJS(hapticWarning)();
        translateX.value = withTiming(-SCREEN_WIDTH * 1.5, { duration: 280 });
        runOnJS(onReject)();
      } else if (exceedsUp) {
        runOnJS(hapticMedium)();
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
        runOnJS(onEdit)();
      } else {
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
        hintFired.current = false;
      }
    });

  // Stack transforms for non-top cards
  const stackScale = 1 - stackDepth * 0.04;
  const stackOffsetY = stackDepth * 12;

  const cardStyle = useAnimatedStyle(() => {
    const rotate = interpolate(translateX.value, [-SCREEN_WIDTH / 2, SCREEN_WIDTH / 2], [-12, 12], Extrapolation.CLAMP);
    return {
      transform: isTop
        ? [
            { translateX: translateX.value },
            { translateY: translateY.value },
            { rotate: `${rotate}deg` },
          ]
        : [
            { scale: stackScale },
            { translateY: stackOffsetY },
          ],
    };
  });

  // Overlay opacities — only for top card
  const approveOverlayStyle = useAnimatedStyle(() => ({
    opacity: isTop
      ? interpolate(translateX.value, [HINT_APPEAR_AT, SWIPE_X_THRESHOLD], [0, 0.7], Extrapolation.CLAMP)
      : 0,
  }));
  const rejectOverlayStyle = useAnimatedStyle(() => ({
    opacity: isTop
      ? interpolate(translateX.value, [-HINT_APPEAR_AT, -SWIPE_X_THRESHOLD], [0, 0.7], Extrapolation.CLAMP)
      : 0,
  }));
  const editOverlayStyle = useAnimatedStyle(() => ({
    opacity: isTop
      ? interpolate(translateY.value, [-HINT_APPEAR_AT, SWIPE_Y_THRESHOLD], [0, 0.7], Extrapolation.CLAMP)
      : 0,
  }));

  // Hint label opacities
  const approveLabelStyle = useAnimatedStyle(() => ({
    opacity: isTop
      ? interpolate(translateX.value, [HINT_APPEAR_AT, SWIPE_X_THRESHOLD], [0, 1], Extrapolation.CLAMP)
      : 0,
  }));
  const rejectLabelStyle = useAnimatedStyle(() => ({
    opacity: isTop
      ? interpolate(translateX.value, [-HINT_APPEAR_AT, -SWIPE_X_THRESHOLD], [0, 1], Extrapolation.CLAMP)
      : 0,
  }));
  const editLabelStyle = useAnimatedStyle(() => ({
    opacity: isTop
      ? interpolate(translateY.value, [-HINT_APPEAR_AT, SWIPE_Y_THRESHOLD], [0, 1], Extrapolation.CLAMP)
      : 0,
  }));

  const content = item.fullContent ?? item.preview;
  const recipientText = item.recipients.join(', ');

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.card, cardStyle, { shadowColor: meta.accent }]}>
        {/* Category accent strip */}
        <View style={[styles.accentStrip, { backgroundColor: meta.accent }]} />

        {/* Gradient overlays for swipe direction */}
        <Animated.View style={[StyleSheet.absoluteFillObject, approveOverlayStyle]} pointerEvents="none">
          <LinearGradient
            colors={['transparent', 'rgba(52,199,89,0.55)']}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFillObject}
          />
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFillObject, rejectOverlayStyle]} pointerEvents="none">
          <LinearGradient
            colors={['rgba(255,59,48,0.55)', 'transparent']}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFillObject}
          />
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFillObject, editOverlayStyle]} pointerEvents="none">
          <LinearGradient
            colors={['rgba(99,102,241,0.55)', 'transparent']}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />
        </Animated.View>

        {/* Content */}
        <View style={styles.body}>
          {/* Category label */}
          <View style={styles.categoryRow}>
            <Text style={styles.categoryIcon}>{meta.icon}</Text>
            <Text style={[styles.categoryLabel, { color: meta.accent }]}>{meta.label.toUpperCase()}</Text>
            {meta.highStakes && (
              <View style={styles.highStakesBadge}>
                <Text style={styles.highStakesText}>HIGH STAKES</Text>
              </View>
            )}
          </View>

          {/* Recipients */}
          {recipientText.length > 0 && (
            <Text style={styles.recipients} numberOfLines={1}>To: {recipientText}</Text>
          )}

          {/* Content preview */}
          <Text style={styles.preview} numberOfLines={6}>{content}</Text>
        </View>

        {/* Hint labels */}
        <Animated.Text style={[styles.hintLabel, styles.hintApprove, approveLabelStyle]}>
          {item.actionType === 'post_social' ? 'SHARE ↗' : 'APPROVE ✓'}
        </Animated.Text>
        <Animated.Text style={[styles.hintLabel, styles.hintReject, rejectLabelStyle]}>
          ✗ REJECT
        </Animated.Text>
        <Animated.Text style={[styles.hintLabel, styles.hintEdit, editLabelStyle]}>
          ✏️ EDIT
        </Animated.Text>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    minHeight: 340,
    backgroundColor: '#fff',
    borderRadius: 24,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.06)',
  },
  accentStrip: {
    width: 6,
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    borderTopLeftRadius: 24,
    borderBottomLeftRadius: 24,
  },
  body: {
    flex: 1,
    paddingLeft: 22,
    paddingRight: 16,
    paddingVertical: 20,
    gap: 10,
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  categoryIcon: { fontSize: 18 },
  categoryLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    fontFamily: 'ui-rounded',
  },
  highStakesBadge: {
    backgroundColor: '#EF4444',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginLeft: 4,
  },
  highStakesText: { color: '#fff', fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  recipients: {
    fontSize: 13,
    color: '#6B7280',
    fontFamily: 'system-ui',
  },
  preview: {
    fontSize: 17,
    color: '#1a1a1a',
    lineHeight: 27,
    fontFamily: 'ui-serif',
    flexShrink: 1,
  },
  hintLabel: {
    position: 'absolute',
    fontSize: 26,
    fontWeight: '800',
    fontFamily: 'ui-rounded',
  },
  hintApprove: {
    top: 24,
    right: 20,
    color: '#34c759',
    transform: [{ rotate: '-20deg' }],
  },
  hintReject: {
    top: 24,
    left: 20,
    color: '#ff3b30',
    transform: [{ rotate: '20deg' }],
  },
  hintEdit: {
    bottom: 24,
    alignSelf: 'center',
    left: '35%',
    color: '#6366f1',
  },
});
