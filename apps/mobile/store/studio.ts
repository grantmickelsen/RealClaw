import { create } from 'zustand';
import { usePreferencesStore } from './preferences';

export interface DraftSet {
  mlsDescription?: string;
  instagramCaption?: string;
  facebookPost?: string;
  emailContent?: string;
  smsText?: string;
  complianceFlags: string[];
}

export type DraftField = 'mlsDescription' | 'instagramCaption' | 'facebookPost' | 'emailContent' | 'smsText';

type Preset = 'new_listing' | 'just_sold' | 'open_house_recap' | 'price_reduction';
type Tone = 'Luxury' | 'Approachable' | 'Investor' | 'First-Time Buyer' | 'Standard';
export type StudioMode = 'content' | 'staging';

interface StudioState {
  loading: boolean;
  targetMode: StudioMode;
  preset: Preset;
  selectedTone: Tone;
  keyFeatures: string;
  platforms: string[];
  stagingStyle: string;
  featureJson: object | null;
  drafts: DraftSet | null;
  stagedImageUrl: string | null;
  pendingCorrelationId: string | null;

  setLoading(v: boolean): void;
  setTargetMode(mode: StudioMode): void;
  setPreset(preset: Preset): void;
  setTone(tone: Tone): void;
  setKeyFeatures(v: string): void;
  setPlatforms(platforms: string[]): void;
  setStagingStyle(style: string): void;
  setResult(featureJson: object, drafts: DraftSet): void;
  setStagingResult(url: string): void;
  updateDraft(field: DraftField, value: string): void;
  setPendingCorrelationId(id: string | null): void;
  reset(): void;
}

export const useStudioStore = create<StudioState>((set) => ({
  loading: false,
  targetMode: 'content',
  preset: 'new_listing',
  selectedTone: 'Standard',
  keyFeatures: '',
  platforms: ['MLS', 'Instagram', 'Facebook'],
  stagingStyle: 'Modern',
  featureJson: null,
  drafts: null,
  stagedImageUrl: null,
  pendingCorrelationId: null,

  setLoading: (v) => set({ loading: v }),

  setTargetMode: (mode) => set({ targetMode: mode, drafts: null, stagedImageUrl: null, featureJson: null }),

  setPreset: (preset) => set({ preset, drafts: null, featureJson: null }),

  setTone: (tone) => set({ selectedTone: tone }),

  setKeyFeatures: (v) => set({ keyFeatures: v }),

  setPlatforms: (platforms) => set({ platforms }),

  setStagingStyle: (style) => set({ stagingStyle: style }),

  setResult: (featureJson, drafts) => set({ featureJson, drafts, loading: false, pendingCorrelationId: null }),

  setStagingResult: (url) => set({ stagedImageUrl: url, loading: false, pendingCorrelationId: null }),

  setPendingCorrelationId: (id) => set({ pendingCorrelationId: id }),

  updateDraft: (field, value) => set((s) => {
    if (!s.drafts) return s;
    const updated = { ...s.drafts, [field]: value };
    usePreferencesStore.getState().setPreferences({
      tonePrefs: {
        ...usePreferencesStore.getState().tonePrefs,
        [`studio_${field}`]: value.slice(0, 200),
      },
    });
    return { drafts: updated };
  }),

  reset: () => set({
    loading: false,
    targetMode: 'content',
    featureJson: null,
    drafts: null,
    stagedImageUrl: null,
    keyFeatures: '',
    pendingCorrelationId: null,
    platforms: ['MLS', 'Instagram', 'Facebook'],
    stagingStyle: 'Modern',
  }),
}));
