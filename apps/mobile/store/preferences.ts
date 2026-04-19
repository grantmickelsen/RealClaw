import { create } from 'zustand';

export interface TonePrefs {
  emailSalutation?: string;
  textSalutation?: string;
  emojisInComms?: boolean;
  emojisInSocial?: boolean;
  formalityLevel?: string;
  preferBullets?: boolean;
  [key: string]: unknown;
}

export interface PreferencesState {
  status: 'loading' | 'loaded';
  primaryZip: string | null;
  displayName: string | null;
  brokerage: string | null;
  phone: string | null;
  llmTier: 'fast' | 'balanced' | 'best';
  tonePrefs: TonePrefs;
  onboardingDone: boolean;
  setPreferences(prefs: Partial<Omit<PreferencesState, 'setPreferences' | 'clear'>>): void;
  clear(): void;
}

export const usePreferencesStore = create<PreferencesState>(set => ({
  status: 'loading',
  primaryZip: null,
  displayName: null,
  brokerage: null,
  phone: null,
  llmTier: 'balanced',
  tonePrefs: {},
  onboardingDone: false,
  setPreferences: prefs => set(state => ({ ...state, ...prefs })),
  clear: () => set({
    status: 'loading',
    primaryZip: null,
    displayName: null,
    brokerage: null,
    phone: null,
    llmTier: 'balanced',
    tonePrefs: {},
    onboardingDone: false,
  }),
}));
