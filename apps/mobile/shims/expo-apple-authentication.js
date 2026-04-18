// Web stub — Apple Sign-In is iOS only.
export const AppleAuthenticationScope = { FULL_NAME: 0, EMAIL: 1 };
export async function signInAsync() {
  throw new Error('Apple Sign-In is not available on web.');
}
export async function isAvailableAsync() { return false; }
export default { AppleAuthenticationScope, signInAsync, isAvailableAsync };
