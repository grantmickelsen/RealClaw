// Web shim for expo-secure-store.
// SecureStore is keychain/keystore only — on web we fall back to localStorage.
// Values are stored in plaintext; this is acceptable for dev/preview web builds
// where native security guarantees don't apply anyway.

export const WHEN_UNLOCKED = 1;
export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 2;
export const AFTER_FIRST_UNLOCK = 3;
export const AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY = 4;
export const ALWAYS = 5;
export const ALWAYS_THIS_DEVICE_ONLY = 6;

export async function getItemAsync(key, _options) {
  return localStorage.getItem(key);
}

export async function setItemAsync(key, value, _options) {
  localStorage.setItem(key, value);
}

export async function deleteItemAsync(key, _options) {
  localStorage.removeItem(key);
}

export function isAvailableAsync() {
  return Promise.resolve(true);
}

export default {
  WHEN_UNLOCKED,
  WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  AFTER_FIRST_UNLOCK,
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  ALWAYS,
  ALWAYS_THIS_DEVICE_ONLY,
  getItemAsync,
  setItemAsync,
  deleteItemAsync,
  isAvailableAsync,
};
