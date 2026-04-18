import * as Device from 'expo-device';
import * as FileSystem from 'expo-file-system/legacy';
import { clearStoredTokens } from './auth';
import { useAuthStore } from '../store/auth';

// Known jailbreak / root indicators
const IOS_JAILBREAK_PATHS = [
  '/Applications/Cydia.app',
  '/Library/MobileSubstrate/MobileSubstrate.dylib',
  '/bin/bash',
  '/usr/sbin/sshd',
  '/etc/apt',
];

const ANDROID_ROOT_PATHS = [
  '/system/bin/su',
  '/system/xbin/su',
  '/sbin/su',
  '/data/local/xbin/su',
  '/data/local/bin/su',
];

async function checkPathExists(path: string): Promise<boolean> {
  try {
    const info = await FileSystem.getInfoAsync(path);
    return info.exists;
  } catch {
    return false;
  }
}

/**
 * Returns true if the device appears to be rooted or jailbroken.
 * Uses expo-device's built-in check + manual path checks.
 */
export async function isDeviceCompromised(): Promise<boolean> {
  try {
    const deviceCheck = await Device.isRootedExperimentalAsync();
    if (deviceCheck) return true;
  } catch {
    // Not all platforms support this
  }

  const paths = Device.osName === 'iOS' ? IOS_JAILBREAK_PATHS : ANDROID_ROOT_PATHS;
  const results = await Promise.all(paths.map(checkPathExists));
  return results.some(Boolean);
}

/**
 * Run on app foreground. If compromised: clear tokens, force sign-out.
 * Returns true if compromised (caller should prevent app use).
 */
export async function enforceDeviceIntegrity(): Promise<boolean> {
  const compromised = await isDeviceCompromised();
  if (compromised) {
    await clearStoredTokens();
    useAuthStore.getState().clearTokens();
    console.warn('[Security] Jailbroken/rooted device detected — tokens cleared');
  }
  return compromised;
}
