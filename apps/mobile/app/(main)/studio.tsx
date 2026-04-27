import { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput,
  TouchableOpacity, ActivityIndicator, Alert, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { authedFetch } from '../../lib/api';
import { useStudioStore } from '../../store/studio';
import { useSubscriptionStore } from '../../store/subscription';
import { PaywallModal } from '../../components/paywall/PaywallModal';
import { StudioModeToggle } from '../../components/studio/StudioModeToggle';
import { ToneSelector } from '../../components/studio/ToneSelector';
import { StyleSelector } from '../../components/studio/StyleSelector';
import { PlatformSelector } from '../../components/studio/PlatformSelector';
import { AssetUploader, type PickedAsset } from '../../components/studio/AssetUploader';
import { DraftCard } from '../../components/studio/DraftCard';
import type { DraftField } from '../../store/studio';

type Preset = 'new_listing' | 'just_sold' | 'open_house_recap' | 'price_reduction';

const PRESETS: { id: Preset; label: string; icon: string }[] = [
  { id: 'new_listing',      label: 'New Listing',      icon: '🏠' },
  { id: 'just_sold',        label: 'Just Sold',        icon: '🎉' },
  { id: 'open_house_recap', label: 'Open House Recap', icon: '👥' },
  { id: 'price_reduction',  label: 'Price Reduction',  icon: '💰' },
];

const DRAFT_FIELDS: DraftField[] = ['mlsDescription', 'instagramCaption', 'facebookPost', 'emailContent', 'smsText'];

export default function StudioScreen() {
  const isProfessional = useSubscriptionStore(s => s.isProfessional);
  const [paywallVisible, setPaywallVisible] = useState(false);
  const [assets, setAssets] = useState<PickedAsset[]>([]);

  useEffect(() => {
    if (!isProfessional) setPaywallVisible(true);
  }, [isProfessional]);

  if (!isProfessional) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#F9FAFB' }}>
        <PaywallModal visible={paywallVisible} onClose={() => setPaywallVisible(false)} contextTitle="Unlock Content Studio" />
      </SafeAreaView>
    );
  }

  const loading          = useStudioStore(s => s.loading);
  const targetMode       = useStudioStore(s => s.targetMode);
  const preset           = useStudioStore(s => s.preset);
  const selectedTone     = useStudioStore(s => s.selectedTone);
  const keyFeatures      = useStudioStore(s => s.keyFeatures);
  const platforms        = useStudioStore(s => s.platforms);
  const stagingStyle     = useStudioStore(s => s.stagingStyle);
  const featureJson      = useStudioStore(s => s.featureJson);
  const drafts           = useStudioStore(s => s.drafts);
  const stagedImageUrl   = useStudioStore(s => s.stagedImageUrl);
  const setLoading       = useStudioStore(s => s.setLoading);
  const setTargetMode    = useStudioStore(s => s.setTargetMode);
  const setPreset        = useStudioStore(s => s.setPreset);
  const setTone          = useStudioStore(s => s.setTone);
  const setKeyFeatures   = useStudioStore(s => s.setKeyFeatures);
  const setPlatforms     = useStudioStore(s => s.setPlatforms);
  const setStagingStyle  = useStudioStore(s => s.setStagingStyle);
  const setPending       = useStudioStore(s => s.setPendingCorrelationId);
  const reset            = useStudioStore(s => s.reset);

  const handleTogglePlatform = useCallback((platform: string) => {
    if (platforms.includes(platform)) {
      if (platforms.length === 1) return; // keep at least one
      setPlatforms(platforms.filter(p => p !== platform));
    } else {
      setPlatforms([...platforms, platform]);
    }
  }, [platforms, setPlatforms]);

  const handleGenerate = useCallback(async () => {
    if (!keyFeatures.trim() && assets.length === 0) {
      Alert.alert('Add details', 'Enter key features or add photos to generate content.');
      return;
    }
    setLoading(true);
    try {
      const images = assets.filter(a => a.base64).map(a => a.base64!);
      const res = await authedFetch('/v1/content/generate', {
        method: 'POST',
        body: JSON.stringify({
          targetMode: 'content',
          assets: images,
          textPrompt: keyFeatures.trim(),
          platforms,
          preset,
          tone: selectedTone,
        }),
      });
      if (!res.ok) {
        setLoading(false);
        Alert.alert('Error', 'Failed to start generation. Please try again.');
        return;
      }
      const { correlationId } = await res.json() as { correlationId: string };
      setPending(correlationId);
    } catch {
      setLoading(false);
      Alert.alert('Error', 'Network error. Please try again.');
    }
  }, [preset, selectedTone, keyFeatures, assets, platforms, setLoading, setPending]);

  const handleRegenerate = useCallback(async () => {
    if (!featureJson) return;
    setLoading(true);
    try {
      const res = await authedFetch('/v1/content/generate', {
        method: 'POST',
        body: JSON.stringify({
          targetMode: 'content',
          assets: [],
          textPrompt: keyFeatures,
          platforms,
          preset,
          tone: selectedTone,
          // pass cached featureJson so backend skips vision step
          featureJson,
        }),
      });
      if (!res.ok) {
        setLoading(false);
        Alert.alert('Error', 'Regeneration failed. Please try again.');
        return;
      }
      const { correlationId } = await res.json() as { correlationId: string };
      setPending(correlationId);
    } catch {
      setLoading(false);
      Alert.alert('Error', 'Network error. Please try again.');
    }
  }, [featureJson, selectedTone, preset, keyFeatures, platforms, setLoading, setPending]);

  const handleStageRoom = useCallback(async () => {
    if (assets.length === 0 || !assets[0]?.base64) {
      Alert.alert('Add a photo', 'Upload a well-lit, empty room photo to stage.');
      return;
    }
    setLoading(true);
    try {
      const res = await authedFetch('/v1/content/generate', {
        method: 'POST',
        body: JSON.stringify({
          targetMode: 'staging',
          assets: [assets[0].base64],
          textPrompt: stagingStyle,
          platforms: [],
        }),
      });
      if (!res.ok) {
        setLoading(false);
        Alert.alert('Error', 'Failed to start staging. Please try again.');
        return;
      }
      const { correlationId } = await res.json() as { correlationId: string };
      setPending(correlationId);
    } catch {
      setLoading(false);
      Alert.alert('Error', 'Network error. Please try again.');
    }
  }, [assets, stagingStyle, setLoading, setPending]);

  const hasImage = assets.length > 0 && assets[0]?.base64;
  const isStaging = targetMode === 'staging';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>The Studio</Text>
        {(drafts || stagedImageUrl) && (
          <TouchableOpacity onPress={() => { reset(); setAssets([]); }}>
            <Text style={styles.resetBtn}>New</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Mode toggle */}
        <StudioModeToggle mode={targetMode} onSelect={(m) => { setTargetMode(m); setAssets([]); }} />

        {isStaging ? (
          /* ── Staging mode ── */
          <>
            <Text style={styles.sectionLabel}>Room Photo</Text>
            <AssetUploader
              assets={assets}
              onChange={setAssets}
              maxCount={1}
              required
              helpText="Upload a well-lit, empty room"
            />

            <Text style={styles.sectionLabel}>Style</Text>
            <StyleSelector selected={stagingStyle} onSelect={setStagingStyle} />

            <View style={styles.generateRow}>
              <TouchableOpacity
                style={[styles.generateBtn, (!hasImage || loading) && styles.btnDisabled]}
                onPress={handleStageRoom}
                disabled={!hasImage || loading}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.generateBtnText}>Stage Room →</Text>
                )}
              </TouchableOpacity>
            </View>

            {stagedImageUrl && (
              <>
                <Text style={styles.draftsHeader}>Staged Result</Text>
                <View style={styles.stagedImageContainer}>
                  <Image
                    source={{ uri: stagedImageUrl }}
                    style={styles.stagedImage}
                    resizeMode="cover"
                  />
                </View>
                <View style={styles.generateRow}>
                  <TouchableOpacity
                    style={[styles.regenBtn, loading && styles.btnDisabled]}
                    onPress={handleStageRoom}
                    disabled={loading}
                  >
                    <Text style={styles.regenBtnText}>
                      {loading ? 'Staging…' : 'Regenerate →'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </>
        ) : (
          /* ── Content mode ── */
          <>
            <Text style={styles.sectionLabel}>Preset</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.presetsRow}>
              {PRESETS.map(p => (
                <TouchableOpacity
                  key={p.id}
                  style={[styles.presetChip, preset === p.id && styles.presetChipActive]}
                  onPress={() => { setPreset(p.id); setAssets([]); }}
                >
                  <Text style={styles.presetIcon}>{p.icon}</Text>
                  <Text style={[styles.presetLabel, preset === p.id && styles.presetLabelActive]}>
                    {p.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.sectionLabel}>Platforms</Text>
            <PlatformSelector selected={platforms} onToggle={handleTogglePlatform} />

            <Text style={styles.sectionLabel}>Photos</Text>
            <AssetUploader assets={assets} onChange={setAssets} />
            {assets.length > 0 && (
              <Text style={styles.visionBadge}>✨ AI will analyze your photos</Text>
            )}

            <Text style={styles.sectionLabel}>Key Features</Text>
            <TextInput
              style={styles.featuresInput}
              value={keyFeatures}
              onChangeText={setKeyFeatures}
              placeholder="New roof, ADU potential, walkable to shops, updated kitchen…"
              placeholderTextColor="#9CA3AF"
              multiline
              maxLength={500}
              textAlignVertical="top"
            />

            <Text style={styles.sectionLabel}>Tone</Text>
            <ToneSelector selected={selectedTone} onSelect={setTone} />

            <View style={styles.generateRow}>
              {drafts ? (
                <TouchableOpacity
                  style={[styles.regenBtn, loading && styles.btnDisabled]}
                  onPress={handleRegenerate}
                  disabled={loading}
                >
                  <Text style={styles.regenBtnText}>
                    {loading ? 'Generating…' : 'Regenerate with new tone →'}
                  </Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.generateBtn, loading && styles.btnDisabled]}
                  onPress={handleGenerate}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.generateBtnText}>Generate Content →</Text>
                  )}
                </TouchableOpacity>
              )}
            </View>

            {drafts && (
              <>
                <Text style={styles.draftsHeader}>Generated Drafts</Text>
                {DRAFT_FIELDS
                  .filter(f => drafts[f] != null && drafts[f] !== '')
                  .map(f => (
                    <DraftCard
                      key={f}
                      field={f}
                      value={drafts[f]!}
                      complianceFlags={drafts.complianceFlags}
                    />
                  ))}
              </>
            )}
          </>
        )}

        <View style={{ height: 80 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f2f2f7' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
  },
  title: { fontSize: 28, fontWeight: '700', color: '#1a1a1a' },
  resetBtn: { fontSize: 16, color: '#0066FF', fontWeight: '600' },
  scroll: { paddingTop: 8, paddingBottom: 40 },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 16,
    marginTop: 20,
    marginBottom: 8,
  },
  presetsRow: { paddingHorizontal: 16, gap: 8, paddingVertical: 2 },
  presetChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  presetChipActive: { backgroundColor: '#0066FF', borderColor: '#0066FF' },
  presetIcon: { fontSize: 16 },
  presetLabel: { fontSize: 14, fontWeight: '500', color: '#444' },
  presetLabelActive: { color: '#fff', fontWeight: '700' },
  visionBadge: {
    fontSize: 13,
    color: '#0066FF',
    paddingHorizontal: 16,
    paddingTop: 4,
    fontWeight: '500',
  },
  featuresInput: {
    marginHorizontal: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: '#1a1a1a',
    minHeight: 80,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    textAlignVertical: 'top',
  },
  generateRow: { marginHorizontal: 16, marginTop: 20 },
  generateBtn: {
    backgroundColor: '#0066FF',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  generateBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  regenBtn: {
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#0066FF',
  },
  regenBtnText: { color: '#0066FF', fontSize: 15, fontWeight: '600' },
  btnDisabled: { opacity: 0.55 },
  draftsHeader: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1a1a1a',
    paddingHorizontal: 16,
    marginTop: 24,
    marginBottom: 4,
  },
  stagedImageContainer: {
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#e0e0e0',
  },
  stagedImage: {
    width: '100%',
    aspectRatio: 1,
  },
});
