import { Linking, Platform } from 'react-native';

/**
 * Open turn-by-turn navigation to a single destination.
 * iOS → Apple Maps (native, no install check needed).
 * Android → Google Maps navigation; falls back to Google Maps web URL if app not installed.
 */
export async function openNavigation(destination: string): Promise<void> {
  const encoded = encodeURIComponent(destination);

  if (Platform.OS === 'ios') {
    await Linking.openURL(`maps://?daddr=${encoded}&dirflg=d`);
  } else {
    const googleUrl = `google.navigation:q=${encoded}&mode=d`;
    const canOpen = await Linking.canOpenURL(googleUrl).catch(() => false);
    await Linking.openURL(
      canOpen
        ? googleUrl
        : `https://www.google.com/maps/dir/?api=1&destination=${encoded}&travelmode=driving`,
    );
  }
}
