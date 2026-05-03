import { useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, Modal, TextInput,
  KeyboardAvoidingView, Platform, ScrollView, Alert,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle, useSharedValue, withTiming, withSpring,
  runOnJS, interpolate, Extrapolation,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { authedFetch } from '../../lib/api';
import { useBriefingStore, type BriefingItem } from '../../store/briefing';
import { useContactsStore } from '../../store/contacts';

type BriefingType = BriefingItem['type'];

const TYPE_COLORS: Record<BriefingType, string> = {
  compliance_flag: '#EF4444',
  deal_deadline:   '#F97316',
  follow_up:       '#0066FF',
  new_lead:        '#22C55E',
  market_alert:    '#8B5CF6',
  showing_prep:    '#9CA3AF',
};

const TYPE_ICONS: Record<BriefingType, string> = {
  compliance_flag: '🚨',
  deal_deadline:   '⏰',
  follow_up:       '💬',
  new_lead:        '⭐',
  market_alert:    '📊',
  showing_prep:    '🏠',
};

const TYPE_LABELS: Record<BriefingType, string> = {
  compliance_flag: 'Compliance',
  deal_deadline:   'Deadline',
  follow_up:       'Follow Up',
  new_lead:        'New Lead',
  market_alert:    'Market Alert',
  showing_prep:    'Showing Prep',
};

const MEDIUM_LABELS: Record<string, string> = {
  sms:   '💬 SMS',
  email: '📧 Email',
  note:  '📝 Note',
};

const SWIPE_THRESHOLD = 110;
const HINT_AT = 40;

interface Props {
  item: BriefingItem;
}

function hapticLight() { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); }
function hapticWarn()  { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {}); }

export function ActionCard({ item }: Props) {
  const [detailOpen, setDetailOpen] = useState(false);
  const [draft, setDraft] = useState(item.draftContent ?? '');
  const [approving, setApproving] = useState(false);
  const [editorFocused, setEditorFocused] = useState(false);
  const hintFired = useRef(false);
  const dismissItem = useBriefingStore(s => s.dismissItem);
  const addPendingApproval = useBriefingStore(s => s.addPendingApproval);
  const contactName = useContactsStore(
    s => item.contactId ? (s.contacts.find(c => c.id === item.contactId)?.name ?? null) : null,
  );
  const translateX = useSharedValue(0);
  const accent = TYPE_COLORS[item.type];

  async function doDismiss() {
    dismissItem(item.id);
    try { await authedFetch(`/v1/briefing/${item.id}`, { method: 'DELETE' }); } catch { /* optimistic */ }
  }

  async function handleApprove() {
    setApproving(true);
    try {
      const res = await authedFetch(`/v1/briefing/${item.id}/approve`, {
        method: 'POST',
        body: JSON.stringify({ draftContent: draft }),
      });
      if (res.ok) {
        const data = await res.json() as { ok: boolean; approvalId?: string };
        setDetailOpen(false);
        dismissItem(item.id);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        if (data.approvalId) {
          addPendingApproval(data.approvalId);
        }
      } else {
        Alert.alert('Error', 'Could not queue for approval. Please try again.');
      }
    } catch {
      Alert.alert('Error', 'Network error. Please try again.');
    } finally {
      setApproving(false);
    }
  }

  const gesture = Gesture.Pan()
    .onUpdate(e => {
      translateX.value = e.translationX;
      if (!hintFired.current && Math.abs(e.translationX) > HINT_AT) {
        runOnJS(hapticLight)();
        hintFired.current = true;
      }
    })
    .onEnd(e => {
      if (e.translationX < -SWIPE_THRESHOLD || e.velocityX < -800) {
        runOnJS(hapticWarn)();
        translateX.value = withTiming(-600, { duration: 260 });
        runOnJS(doDismiss)();
      } else {
        translateX.value = withSpring(0);
        hintFired.current = false;
      }
    });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
    opacity: interpolate(translateX.value, [-SWIPE_THRESHOLD, 0], [0.3, 1], Extrapolation.CLAMP),
  }));

  const hintStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [-HINT_AT, -SWIPE_THRESHOLD], [0, 1], Extrapolation.CLAMP),
  }));

  return (
    <>
      <GestureDetector gesture={gesture}>
        <Animated.View style={[styles.card, cardStyle]}>
          <View style={[styles.accentStrip, { backgroundColor: accent }]} />

          <Animated.Text style={[styles.dismissHint, hintStyle]}>DISMISS ✕</Animated.Text>

          <Pressable
            style={styles.body}
            onPress={() => { setDraft(item.draftContent ?? ''); setDetailOpen(true); }}
          >
            <View style={styles.typeRow}>
              <Text style={styles.typeIcon}>{TYPE_ICONS[item.type]}</Text>
              <Text style={[styles.typeLabel, { color: accent }]}>
                {TYPE_LABELS[item.type].toUpperCase()}
              </Text>
              {item.urgencyScore >= 8 && (
                <View style={[styles.urgencyBadge, { backgroundColor: accent }]}>
                  <Text style={styles.urgencyText}>URGENT</Text>
                </View>
              )}
            </View>

            {contactName && <Text style={styles.contactName}>{contactName}</Text>}
            <Text style={styles.summary} numberOfLines={3}>{item.summaryText}</Text>

            {item.draftContent ? (
              <View style={styles.draftPreview}>
                {item.draftMedium && (
                  <Text style={styles.mediumBadge}>{MEDIUM_LABELS[item.draftMedium] ?? item.draftMedium}</Text>
                )}
                <Text style={styles.draftText} numberOfLines={2}>{item.draftContent}</Text>
              </View>
            ) : null}

            <Text style={[styles.cta, { color: accent }]}>Tap to review →</Text>
          </Pressable>
        </Animated.View>
      </GestureDetector>

      <Modal
        visible={detailOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setDetailOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setDetailOpen(false)} />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.sheetWrapper}
        >
          <View style={styles.sheet}>
            <View style={styles.handle} />

            <View style={styles.sheetHeader}>
              <View style={styles.typeRow}>
                <Text style={styles.typeIcon}>{TYPE_ICONS[item.type]}</Text>
                <Text style={[styles.typeLabel, { color: accent }]}>
                  {TYPE_LABELS[item.type].toUpperCase()}
                </Text>
                {item.draftMedium && (
                  <View style={[styles.mediumChip, { borderColor: accent }]}>
                    <Text style={[styles.mediumChipText, { color: accent }]}>
                      {MEDIUM_LABELS[item.draftMedium] ?? item.draftMedium}
                    </Text>
                  </View>
                )}
              </View>
              <Pressable onPress={() => setDetailOpen(false)} hitSlop={12}>
                <Text style={styles.closeBtn}>✕</Text>
              </Pressable>
            </View>

            {contactName && (
              <Text style={styles.sheetContactName}>{contactName}</Text>
            )}
            <Text style={styles.sheetSummary}>{item.summaryText}</Text>
            <Text style={styles.sheetTimestamp}>
              {(() => {
                const d = new Date((item.createdAt ?? '').replace(' ', 'T'));
                return isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
              })()}
            </Text>

            {item.draftContent != null && (
              <>
                <Text style={styles.draftLabel}>Draft (tap to edit)</Text>
                <TextInput
                  style={[styles.editor, editorFocused && styles.editorExpanded]}
                  value={draft}
                  onChangeText={setDraft}
                  multiline
                  textAlignVertical="top"
                  placeholderTextColor="#9CA3AF"
                  onFocus={() => setEditorFocused(true)}
                  onBlur={() => setEditorFocused(false)}
                />
              </>
            )}

            <Pressable
              style={[styles.approveBtn, { backgroundColor: accent }, approving && styles.btnDisabled]}
              onPress={handleApprove}
              disabled={approving}
            >
              <Text style={styles.approveBtnText}>
                {approving ? 'Sending…' : 'Send to Approval →'}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => { setDetailOpen(false); void doDismiss(); }}
              style={styles.dismissLink}
            >
              <Text style={styles.dismissLinkText}>Dismiss this item</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginVertical: 6,
    backgroundColor: '#fff',
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  accentStrip: {
    position: 'absolute',
    top: 0, bottom: 0, left: 0,
    width: 5,
    borderTopLeftRadius: 16,
    borderBottomLeftRadius: 16,
  },
  dismissHint: {
    position: 'absolute',
    top: 16, right: 16,
    fontSize: 13,
    fontWeight: '800',
    color: '#EF4444',
    letterSpacing: 1,
  },
  body: {
    paddingLeft: 21,
    paddingRight: 16,
    paddingVertical: 14,
    gap: 8,
  },
  typeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  typeIcon: { fontSize: 16 },
  typeLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1.1 },
  urgencyBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginLeft: 4,
  },
  urgencyText: { color: '#fff', fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  contactName: { fontSize: 13, fontWeight: '700', color: '#374151' },
  summary: { fontSize: 16, color: '#1a1a1a', lineHeight: 24 },
  draftPreview: {
    backgroundColor: '#f7f7fa',
    borderRadius: 10,
    padding: 10,
    gap: 4,
  },
  mediumBadge: { fontSize: 12, color: '#666', fontWeight: '600' },
  draftText: { fontSize: 14, color: '#444', lineHeight: 20 },
  cta: { fontSize: 14, fontWeight: '700', marginTop: 2 },

  // Modal styles
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheetWrapper: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'ios' ? 36 : 20,
    maxHeight: '85%',
    minHeight: 300,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 20,
  },
  handle: {
    width: 36, height: 4,
    backgroundColor: '#E5E7EB',
    borderRadius: 999,
    alignSelf: 'center',
    marginTop: 12, marginBottom: 16,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  mediumChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginLeft: 6,
  },
  mediumChipText: { fontSize: 11, fontWeight: '600' },
  closeBtn: { fontSize: 17, color: '#9CA3AF', paddingHorizontal: 4 },
  sheetContactName: { fontSize: 15, fontWeight: '700', color: '#374151', marginBottom: 4 },
  sheetSummary: { fontSize: 16, color: '#1a1a1a', lineHeight: 24, marginBottom: 6 },
  sheetTimestamp: { fontSize: 12, color: '#9CA3AF', marginBottom: 14 },
  draftLabel: { fontSize: 12, fontWeight: '600', color: '#9CA3AF', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  editor: {
    fontSize: 15,
    color: '#1a1a1a',
    lineHeight: 24,
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 12,
    minHeight: 120,
    maxHeight: 180,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 14,
  },
  editorExpanded: {
    minHeight: 280,
    maxHeight: 280,
  },
  approveBtn: {
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    marginBottom: 10,
  },
  btnDisabled: { opacity: 0.55 },
  approveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  dismissLink: { alignItems: 'center', paddingVertical: 8 },
  dismissLinkText: { fontSize: 14, color: '#9CA3AF' },
});
