import { create } from 'zustand';

export interface ContactCard {
  id: string;
  temperatureScore: number;
  nextAction: string;
  contactType: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  stage: string | null;
  source: string | null;
  budget: string | null;
  timeline: string | null;
}

export interface SuggestedAction {
  label: string;
  actionType: string;
  preview: string;
}

interface ContactsState {
  contacts: ContactCard[];
  loading: boolean;
  dossierContactId: string | null;
  dossierNarrative: string;
  dossierActions: SuggestedAction[];
  dossierLoading: boolean;
  pendingDossierCorrelationId: string | null;

  setContacts(contacts: ContactCard[]): void;
  setLoading(v: boolean): void;
  openDossier(contactId: string): void;
  closeDossier(): void;
  setDossierResult(narrative: string, actions: SuggestedAction[]): void;
  setPendingDossierCorrelationId(id: string | null): void;
}

export const useContactsStore = create<ContactsState>((set) => ({
  contacts: [],
  loading: false,
  dossierContactId: null,
  dossierNarrative: '',
  dossierActions: [],
  dossierLoading: false,
  pendingDossierCorrelationId: null,

  setContacts: (contacts) => set({ contacts }),
  setLoading: (v) => set({ loading: v }),
  openDossier: (contactId) => set({
    dossierContactId: contactId,
    dossierNarrative: '',
    dossierActions: [],
    dossierLoading: true,
  }),
  closeDossier: () => set({
    dossierContactId: null,
    dossierNarrative: '',
    dossierActions: [],
    dossierLoading: false,
    pendingDossierCorrelationId: null,
  }),
  setDossierResult: (narrative, actions) => set({
    dossierNarrative: narrative,
    dossierActions: actions,
    dossierLoading: false,
  }),
  setPendingDossierCorrelationId: (id) => set({ pendingDossierCorrelationId: id }),
}));
