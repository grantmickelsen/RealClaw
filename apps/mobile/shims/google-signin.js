// Web stub — Google Sign-In native SDK is iOS/Android only.
export const GoogleSignin = {
  configure() {},
  async hasPlayServices() { return true; },
  async signIn() { throw new Error('Google Sign-In native SDK is not available on web.'); },
  async signOut() {},
  async isSignedIn() { return false; },
};

export const statusCodes = {};

// Stub component — renders nothing on web (Sign-In unavailable).
// Size/Color statics must exist so sign-in.tsx doesn't crash on import.
export function GoogleSigninButton() { return null; }
GoogleSigninButton.Size = { Standard: 0, Wide: 1, Icon: 2 };
GoogleSigninButton.Color = { Dark: 0, Light: 1 };

export default { GoogleSignin, statusCodes, GoogleSigninButton };
