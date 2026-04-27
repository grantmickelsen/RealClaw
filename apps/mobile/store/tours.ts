import { create } from 'zustand';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type TourMode = 'days' | 'curate' | 'live';

export type DayStatus =
  | 'draft'
  | 'proposed_to_client'
  | 'confirmed'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

export type AccessStatus =
  | 'pending'
  | 'negotiating'
  | 'confirmed'
  | 'failed'
  | 'not_needed';

export interface ShowingDay {
  id: string;
  contactId: string;
  contactName: string | null;
  proposedDate: string;       // ISO date YYYY-MM-DD
  proposedStartTime: string | null;
  proposedEndTime: string | null;
  status: DayStatus;
  clientConfirmedAt: string | null;
  propertyCount: number;
  photos: string[];            // up to 3 thumbnail URLs from stops
  createdAt: string;
}

export interface ShowingStop {
  id: string;
  showingDayId: string;
  propertyResultId: string | null;
  address: string;
  sequenceOrder: number;
  scheduledTime: string | null;
  durationMinutes: number;
  accessStatus: AccessStatus;
  accessNotes: string | null;  // lockbox code, access instructions
  arrivedAt: string | null;
  departedAt: string | null;
  photos: string[];
  price: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  matchScore: number | null;
}

export interface PropertyResult {
  id: string;
  searchId: string;
  mlsNumber: string | null;
  address: string;
  city: string | null;
  zipCode: string | null;
  price: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  yearBuilt: number | null;
  dom: number | null;
  pool: boolean;
  garageSpaces: number | null;
  photos: string[];
  matchScore: number | null;
  matchedCriteria: string[];
  missingCriteria: string[];
  compensatingFactors: string[];
  showingInstructions: string | null;
  showingType: string;
  listingAgentName: string | null;
  listingAgentPhone: string | null;
}

export interface ShowingRoute {
  id: string;
  showingDayId: string;
  mapsUrl: string;
  totalDistanceMiles: number;
  totalDurationMinutes: number;
  warnings: string[];
  agentApprovedAt: string | null;
}

export interface PendingCuration {
  searchId: string;
  contactId: string;
  contactName: string | null;
  count: number;
}

export interface PendingNote {
  id: string;
  showingDayPropertyId: string;
  transcript: string;
}

// ─── Store ──────────────────────────────────────────────────────────────────

interface ToursState {
  mode: TourMode;

  // Days hub
  showingDays: ShowingDay[];
  showingDaysLoading: boolean;
  pendingCurations: PendingCuration[];

  // Curation swipe queue
  swipeQueue: PropertyResult[];
  swipeIndex: number;
  activeCurateContactId: string | null;
  activeCurateContactName: string | null;
  activeSearchId: string | null;

  // Live route
  activeShowingDayId: string | null;
  activeStops: ShowingStop[];
  currentStopIndex: number;
  fieldOracleContent: string | null;
  fieldOracleLoading: boolean;
  activeRoute: ShowingRoute | null;
  oracleCorrelationId: string | null;

  // Offline note buffer
  pendingNotes: PendingNote[];

  setMode(mode: TourMode): void;
  setShowingDays(days: ShowingDay[]): void;
  setShowingDaysLoading(v: boolean): void;
  addPendingCuration(info: PendingCuration): void;
  clearPendingCuration(searchId: string): void;
  setSwipeQueue(
    queue: PropertyResult[],
    contactId: string,
    contactName: string | null,
    searchId: string,
  ): void;
  swipeProperty(): void;
  setActiveShowingDay(
    dayId: string,
    stops: ShowingStop[],
    route: ShowingRoute | null,
  ): void;
  exitLiveMode(): void;
  setCurrentStopIndex(i: number): void;
  markArrived(stopId: string): void;
  setFieldOracle(
    content: string | null,
    loading: boolean,
    correlationId?: string,
  ): void;
  appendOracleToken(correlationId: string, token: string): void;
  addPendingNote(note: PendingNote): void;
  removePendingNote(id: string): void;
  updateStopAccess(
    stopId: string,
    status: AccessStatus,
    notes: string | null,
  ): void;
}

export const useToursStore = create<ToursState>((set, get) => ({
  mode: 'days',

  showingDays: [],
  showingDaysLoading: false,
  pendingCurations: [],

  swipeQueue: [],
  swipeIndex: 0,
  activeCurateContactId: null,
  activeCurateContactName: null,
  activeSearchId: null,

  activeShowingDayId: null,
  activeStops: [],
  currentStopIndex: 0,
  fieldOracleContent: null,
  fieldOracleLoading: false,
  activeRoute: null,
  oracleCorrelationId: null,

  pendingNotes: [],

  setMode: (mode) => set({ mode }),

  setShowingDays: (days) => set({ showingDays: days }),
  setShowingDaysLoading: (v) => set({ showingDaysLoading: v }),

  addPendingCuration: (info) =>
    set((state) => ({
      pendingCurations: [
        ...state.pendingCurations.filter((c) => c.searchId !== info.searchId),
        info,
      ],
    })),

  clearPendingCuration: (searchId) =>
    set((state) => ({
      pendingCurations: state.pendingCurations.filter(
        (c) => c.searchId !== searchId,
      ),
    })),

  setSwipeQueue: (queue, contactId, contactName, searchId) =>
    set({
      swipeQueue: queue,
      swipeIndex: 0,
      activeCurateContactId: contactId,
      activeCurateContactName: contactName,
      activeSearchId: searchId,
      mode: 'curate',
    }),

  swipeProperty: () => {
    const { swipeIndex, swipeQueue } = get();
    const next = swipeIndex + 1;
    set({
      swipeIndex: next,
      mode: next >= swipeQueue.length ? 'days' : 'curate',
    });
  },

  setActiveShowingDay: (dayId, stops, route) =>
    set({
      activeShowingDayId: dayId,
      activeStops: stops.slice().sort((a, b) => a.sequenceOrder - b.sequenceOrder),
      currentStopIndex: 0,
      activeRoute: route,
      fieldOracleContent: null,
      fieldOracleLoading: false,
      mode: 'live',
    }),

  exitLiveMode: () => set({ mode: 'days' }),

  setCurrentStopIndex: (i) => set({ currentStopIndex: i }),

  markArrived: (stopId) =>
    set((state) => ({
      activeStops: state.activeStops.map((s) =>
        s.id === stopId ? { ...s, arrivedAt: new Date().toISOString() } : s,
      ),
    })),

  setFieldOracle: (content, loading, correlationId) =>
    set({
      fieldOracleContent: content,
      fieldOracleLoading: loading,
      ...(correlationId != null ? { oracleCorrelationId: correlationId } : {}),
    }),

  appendOracleToken: (correlationId, token) => {
    const { oracleCorrelationId, fieldOracleContent } = get();
    if (oracleCorrelationId === correlationId) {
      set({ fieldOracleContent: (fieldOracleContent ?? '') + token });
    }
  },

  addPendingNote: (note) =>
    set((state) => ({ pendingNotes: [...state.pendingNotes, note] })),

  removePendingNote: (id) =>
    set((state) => ({
      pendingNotes: state.pendingNotes.filter((n) => n.id !== id),
    })),

  updateStopAccess: (stopId, status, notes) =>
    set((state) => ({
      activeStops: state.activeStops.map((s) =>
        s.id === stopId ? { ...s, accessStatus: status, accessNotes: notes } : s,
      ),
    })),
}));
