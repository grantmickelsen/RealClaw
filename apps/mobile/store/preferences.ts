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

export type AutoApprovalMode = 'require' | 'auto';

export interface AutoApprovalSettings {
  send_email: AutoApprovalMode;
  send_sms: AutoApprovalMode;
  send_linkedin_dm: AutoApprovalMode;
  modify_calendar: AutoApprovalMode;
  post_social: AutoApprovalMode;
  send_document: AutoApprovalMode;
}

export const DEFAULT_AUTO_APPROVAL_SETTINGS: AutoApprovalSettings = {
  send_email: 'require',
  send_sms: 'require',
  send_linkedin_dm: 'require',
  modify_calendar: 'require',
  post_social: 'require',
  send_document: 'require',
};

export interface PreferencesState {
  status: 'loading' | 'loaded';
  primaryZip: string | null;
  displayName: string | null;
  brokerage: string | null;
  phone: string | null;
  llmTier: 'fast' | 'balanced' | 'best';
  tonePrefs: TonePrefs;
  toneAnalyzedAt: string | null;
  onboardingDone: boolean;
  autoApprovalSettings: AutoApprovalSettings;
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
  toneAnalyzedAt: null,
  onboardingDone: false,
  autoApprovalSettings: { ...DEFAULT_AUTO_APPROVAL_SETTINGS },
  setPreferences: prefs => set(state => ({ ...state, ...prefs })),
  clear: () => set({
    status: 'loading',
    primaryZip: null,
    displayName: null,
    brokerage: null,
    phone: null,
    llmTier: 'balanced',
    tonePrefs: {},
    toneAnalyzedAt: null,
    onboardingDone: false,
    autoApprovalSettings: { ...DEFAULT_AUTO_APPROVAL_SETTINGS },
  }),
}));
