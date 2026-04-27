import { useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  Alert, ScrollView, Linking,
} from 'react-native';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { authedFetch } from '../../lib/api';
import { useContactsStore, type SuggestedAction } from '../../store/contacts';

const SNAP_POINTS = ['55%', '90%'];

const SCORE_COLOR = (score: number) =>
  score >= 70 ? '#EF4444' : score >= 40 ? '#F59E0B' : '#9CA3AF';

interface Props {
  bottomSheetRef: React.RefObject<BottomSheet | null>;
}

async function openLink(url: string) {
  try {
    const supported = await Linking.canOpenURL(url);
    if (supported) await Linking.openURL(url);
  } catch { /* silently ignore */ }
}

export function DossierSheet({ bottomSheetRef }: Props) {
  const dossierContactId = useContactsStore(s => s.dossierContactId);
  const dossierNarrative = useContactsStore(s => s.dossierNarrative);
  const dossierActions = useContactsStore(s => s.dossierActions);
  const dossierLoading = useContactsStore(s => s.dossierLoading);
  const contacts = useContactsStore(s => s.contacts);
  const closeDossier = useContactsStore(s => s.closeDossier);

  const contact = contacts.find(c => c.id === dossierContactId);
  const accentColor = contact ? SCORE_COLOR(contact.temperatureScore) : '#9CA3AF';

  const handleClose = useCallback(() => {
    bottomSheetRef.current?.close();
    closeDossier();
  }, [bottomSheetRef, closeDossier]);

  async function handleAction(action: SuggestedAction) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try {
      const res = await authedFetch('/v1/messages', {
        method: 'POST',
        body: JSON.stringify({
          platform: 'mobile',
          content: action.preview,
          actionType: action.actionType,
        }),
      });
      if (res.ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        Alert.alert('Queued', `"${action.label}" sent to approval carousel.`);
      } else {
        Alert.alert('Error', 'Could not queue action. Please try again.');
      }
    } catch {
      Alert.alert('Error', 'Network error. Please try again.');
    }
  }

  const displayName = contact?.name
    ?? contact?.contactType.replace(/_/g, ' ')
    ?? 'Contact';

  return (
    <BottomSheet
      ref={bottomSheetRef}
      index={-1}
      snapPoints={SNAP_POINTS}
      enablePanDownToClose
      onClose={closeDossier}
      backgroundStyle={styles.sheetBg}
      handleIndicatorStyle={styles.handle}
    >
      <BottomSheetScrollView contentContainerStyle={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <View style={[styles.typeBadge, { backgroundColor: accentColor }]}>
            <Text style={styles.typeBadgeText}>
              {contact?.contactType.replace(/_/g, ' ').toUpperCase() ?? 'CONTACT'}
            </Text>
          </View>
          {contact && (
            <View style={[styles.scorePill, { borderColor: accentColor }]}>
              <Text style={[styles.scorePillText, { color: accentColor }]}>
                {Math.round(contact.temperatureScore)}
              </Text>
            </View>
          )}
          <TouchableOpacity onPress={handleClose} style={styles.closeBtn} hitSlop={12}>
            <Text style={styles.closeBtnText}>Done</Text>
          </TouchableOpacity>
        </View>

        {/* Section 1: Narrative */}
        <Text style={styles.sectionLabel}>SUMMARY</Text>
        {dossierLoading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color="#0066FF" />
            <Text style={styles.loadingText}>Generating summary…</Text>
          </View>
        ) : (
          <Text style={styles.narrative}>{dossierNarrative}</Text>
        )}

        {/* Section 2: Action Buttons */}
        {!dossierLoading && dossierActions.length > 0 && (
          <>
            <Text style={[styles.sectionLabel, { marginTop: 20 }]}>ACTIONS</Text>
            <View style={styles.actionsGrid}>
              {dossierActions.map((action, i) => (
                <TouchableOpacity
                  key={i}
                  style={styles.actionBtn}
                  onPress={() => { void handleAction(action); }}
                  activeOpacity={0.8}
                >
                  <Text style={styles.actionBtnLabel}>{action.label}</Text>
                  <Text style={styles.actionBtnPreview} numberOfLines={2}>
                    {action.preview}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        {/* Section 3: Contact Info */}
        <View style={styles.divider} />
        <Text style={styles.sectionLabel}>CONTACT INFO</Text>

        {/* Name + meta */}
        <Text style={styles.contactName}>{displayName}</Text>
        {(contact?.stage || contact?.source) && (
          <View style={styles.metaRow}>
            {contact.stage ? (
              <View style={styles.stageBadge}>
                <Text style={styles.stageBadgeText}>{contact.stage}</Text>
              </View>
            ) : null}
            {contact.source ? (
              <View style={styles.sourceBadge}>
                <Text style={styles.sourceBadgeText}>{contact.source}</Text>
              </View>
            ) : null}
          </View>
        )}

        {/* Phone row */}
        {contact?.phone ? (
          <View style={styles.linkRow}>
            <Ionicons name="call-outline" size={17} color="#374151" style={styles.linkIcon} />
            <Text style={styles.linkText}>{contact.phone}</Text>
            <View style={styles.linkBtns}>
              <TouchableOpacity
                style={styles.linkBtn}
                onPress={() => { void openLink('tel:' + contact.phone); }}
                hitSlop={8}
              >
                <Text style={styles.linkBtnText}>Call</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.linkBtn, styles.linkBtnPrimary]}
                onPress={() => {
                  bottomSheetRef.current?.close();
                  router.push(`/(main)/sms/${encodeURIComponent(contact.id)}`);
                }}
                hitSlop={8}
              >
                <Text style={[styles.linkBtnText, styles.linkBtnTextPrimary]}>Text</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.linkRow}>
            <Ionicons name="call-outline" size={17} color="#D1D5DB" style={styles.linkIcon} />
            <Text style={styles.linkTextMuted}>No phone number</Text>
          </View>
        )}

        {/* Email row */}
        {contact?.email ? (
          <View style={styles.linkRow}>
            <Ionicons name="mail-outline" size={17} color="#374151" style={styles.linkIcon} />
            <TouchableOpacity onPress={() => { void openLink('mailto:' + contact.email); }}>
              <Text style={styles.linkTextEmail}>{contact.email}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.linkRow}>
            <Ionicons name="mail-outline" size={17} color="#D1D5DB" style={styles.linkIcon} />
            <Text style={styles.linkTextMuted}>No email address</Text>
          </View>
        )}

        <View style={{ height: 40 }} />
      </BottomSheetScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheetBg: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  handle: { backgroundColor: '#D1D5DB', width: 36 },
  content: { paddingHorizontal: 20, paddingTop: 8 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
  },
  typeBadge: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  typeBadgeText: { fontSize: 11, fontWeight: '700', color: '#fff', letterSpacing: 0.5 },
  scorePill: {
    borderRadius: 10,
    borderWidth: 1.5,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  scorePillText: { fontSize: 12, fontWeight: '700' },
  closeBtn: { marginLeft: 'auto' },
  closeBtnText: { fontSize: 15, color: '#0066FF', fontWeight: '600' },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9CA3AF',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 16,
  },
  loadingText: { fontSize: 14, color: '#9CA3AF' },
  narrative: {
    fontSize: 15,
    color: '#1F2937',
    lineHeight: 24,
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 14,
  },
  actionsGrid: { gap: 10 },
  actionBtn: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#0066FF',
    padding: 14,
    gap: 4,
  },
  actionBtnLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0066FF',
  },
  actionBtnPreview: {
    fontSize: 12,
    color: '#6B7280',
    lineHeight: 18,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#E5E7EB',
    marginVertical: 24,
  },
  contactName: {
    fontSize: 22,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 8,
  },
  metaRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  stageBadge: {
    backgroundColor: '#EFF6FF',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  stageBadgeText: { fontSize: 12, fontWeight: '600', color: '#1D4ED8' },
  sourceBadge: {
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  sourceBadgeText: { fontSize: 12, fontWeight: '600', color: '#6B7280' },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F3F4F6',
  },
  linkIcon: { marginRight: 10 },
  linkText: { fontSize: 15, color: '#374151', flex: 1 },
  linkTextEmail: { fontSize: 15, color: '#0066FF', textDecorationLine: 'underline' },
  linkTextMuted: { fontSize: 15, color: '#D1D5DB', flex: 1 },
  linkBtns: { flexDirection: 'row', gap: 8 },
  linkBtn: {
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  linkBtnText: { fontSize: 13, fontWeight: '600', color: '#374151' },
  linkBtnPrimary: { backgroundColor: '#EEF2FF' },
  linkBtnTextPrimary: { color: '#4338CA' },
});
