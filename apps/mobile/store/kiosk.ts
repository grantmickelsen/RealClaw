import { create } from 'zustand';
import type { StoredGuest } from '../lib/db';

interface KioskState {
  isLocked: boolean;
  guests: StoredGuest[];
  requireBiometricForKiosk: boolean;
  lock(): void;
  unlock(): void;
  addGuest(guest: StoredGuest): void;
  setGuests(guests: StoredGuest[]): void;
  setRequireBiometric(v: boolean): void;
}

export const KIOSK_BIOMETRIC_KEY = 'claw_kiosk_require_biometric';

export const useKioskStore = create<KioskState>((set) => ({
  isLocked: false,
  guests: [],
  requireBiometricForKiosk: true,
  lock: () => set({ isLocked: true }),
  unlock: () => set({ isLocked: false }),
  addGuest: (guest) => set((s) => ({ guests: [...s.guests, guest] })),
  setGuests: (guests) => set({ guests }),
  setRequireBiometric: (v) => set({ requireBiometricForKiosk: v }),
}));
