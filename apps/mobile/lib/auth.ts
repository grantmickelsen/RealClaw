import * as SecureStore from 'expo-secure-store';
import * as AppleAuthentication from 'expo-apple-authentication';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { API_BASE_URL } from '../constants/api';
import type { StoredTokens } from '../store/auth';

// ─── SecureStore key names ───
const ACCESS_TOKEN_KEY = 'rca_access_token';
const REFRESH_TOKEN_KEY = 'rca_refresh_token';
const USER_ID_KEY = 'rca_user_id';
const TENANT_ID_KEY = 'rca_tenant_id';
const EXPIRES_AT_KEY = 'rca_expires_at';

// Access token: accessible when device is unlocked
const ACCESS_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED,
};
// Refresh token: device-only (never migrates to a new device via backup restore)
const REFRESH_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export async function loadStoredTokens(): Promise<StoredTokens | null> {
  const [accessToken, refreshToken, userId, tenantId, expiresAtStr] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_TOKEN_KEY, ACCESS_OPTIONS),
    SecureStore.getItemAsync(REFRESH_TOKEN_KEY, REFRESH_OPTIONS),
    SecureStore.getItemAsync(USER_ID_KEY),
    SecureStore.getItemAsync(TENANT_ID_KEY),
    SecureStore.getItemAsync(EXPIRES_AT_KEY),
  ]);

  if (!accessToken || !refreshToken || !userId || !tenantId) return null;

  const expiresAt = parseInt(expiresAtStr ?? '0', 10);
  const secondsRemaining = Math.floor((expiresAt - Date.now()) / 1000);
  // Return with expiresIn = -1 if expired — api.ts triggers proactive refresh on next call
  return { accessToken, refreshToken, userId, tenantId, expiresIn: Math.max(-1, secondsRemaining) };
}

export async function storeTokens(tokens: StoredTokens): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_TOKEN_KEY, tokens.accessToken, ACCESS_OPTIONS),
    SecureStore.setItemAsync(REFRESH_TOKEN_KEY, tokens.refreshToken, REFRESH_OPTIONS),
    SecureStore.setItemAsync(USER_ID_KEY, tokens.userId),
    SecureStore.setItemAsync(TENANT_ID_KEY, tokens.tenantId),
    SecureStore.setItemAsync(EXPIRES_AT_KEY, String(Date.now() + tokens.expiresIn * 1000)),
  ]);
}

export async function clearStoredTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
    SecureStore.deleteItemAsync(USER_ID_KEY),
    SecureStore.deleteItemAsync(TENANT_ID_KEY),
    SecureStore.deleteItemAsync(EXPIRES_AT_KEY),
  ]);
}

export async function signInWithApple(): Promise<StoredTokens> {
  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
  });

  const res = await fetch(`${API_BASE_URL}/v1/auth/apple`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identityToken: credential.identityToken,
      fullName: credential.fullName,
    }),
  });

  if (!res.ok) {
    const err = await res.json() as { error: string };
    throw new Error(err.error ?? 'Apple sign-in failed');
  }

  return res.json() as Promise<StoredTokens>;
}

export async function signInWithGoogle(): Promise<StoredTokens> {
  await GoogleSignin.hasPlayServices();
  const { data } = await GoogleSignin.signIn();
  const idToken = data?.idToken;
  if (!idToken) throw new Error('Google sign-in did not return an ID token');

  const res = await fetch(`${API_BASE_URL}/v1/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });

  if (!res.ok) {
    const err = await res.json() as { error: string };
    throw new Error(err.error ?? 'Google sign-in failed');
  }

  return res.json() as Promise<StoredTokens>;
}

export async function refreshAccessToken(refreshToken: string): Promise<StoredTokens> {
  const res = await fetch(`${API_BASE_URL}/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });

  if (!res.ok) throw new Error('Refresh token expired or revoked');
  return res.json() as Promise<StoredTokens>;
}
