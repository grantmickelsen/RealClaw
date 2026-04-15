import { create } from 'zustand';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  userId: string;
  tenantId: string;
  expiresIn: number;
}

interface AuthState {
  status: AuthStatus;
  accessToken: string | null;
  refreshToken: string | null;
  userId: string | null;
  tenantId: string | null;
  expiresAt: number | null;   // Unix ms
  setTokens(tokens: StoredTokens): void;
  clearTokens(): void;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'loading',
  accessToken: null,
  refreshToken: null,
  userId: null,
  tenantId: null,
  expiresAt: null,

  setTokens(tokens) {
    set({
      status: 'authenticated',
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      userId: tokens.userId,
      tenantId: tokens.tenantId,
      expiresAt: Date.now() + tokens.expiresIn * 1000,
    });
  },

  clearTokens() {
    set({
      status: 'unauthenticated',
      accessToken: null,
      refreshToken: null,
      userId: null,
      tenantId: null,
      expiresAt: null,
    });
  },
}));
