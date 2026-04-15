import { useAuthStore } from '../store/auth';
import { refreshAccessToken, storeTokens, clearStoredTokens } from './auth';
import { API_BASE_URL } from '../constants/api';

let refreshPromise: Promise<void> | null = null;

/**
 * Authenticated fetch wrapper.
 * - Proactively refreshes the access token when it expires within 60 seconds.
 * - Deduplicates concurrent refresh calls (singleton promise).
 * - Clears auth and throws on 401 (token revoked server-side).
 */
export async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const store = useAuthStore.getState();

  // Proactive refresh: token expiring within 60 seconds
  if (store.expiresAt && store.expiresAt - Date.now() < 60_000) {
    if (!refreshPromise) {
      refreshPromise = (async () => {
        try {
          const newTokens = await refreshAccessToken(store.refreshToken!);
          await storeTokens(newTokens);
          store.setTokens(newTokens);
        } catch {
          await clearStoredTokens();
          store.clearTokens();
          throw new Error('Session expired — please sign in again');
        } finally {
          refreshPromise = null;
        }
      })();
    }
    await refreshPromise;
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${useAuthStore.getState().accessToken}`,
      'X-Device-Integrity': 'clean',
      ...init?.headers,
    },
  });

  // 401 means token was revoked server-side — force sign-out
  if (res.status === 401) {
    await clearStoredTokens();
    useAuthStore.getState().clearTokens();
    throw new Error('Session revoked — please sign in again');
  }

  return res;
}
