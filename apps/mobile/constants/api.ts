declare const __DEV__: boolean;

// Expo bakes EXPO_PUBLIC_* vars into the bundle at `expo start` time.
// Set EXPO_PUBLIC_API_HOST in apps/mobile/.env to your Windows LAN IP for phone testing.
const DEV_HOST = process.env.EXPO_PUBLIC_API_HOST ?? 'localhost';

export const API_BASE_URL: string = __DEV__
  ? `http://${DEV_HOST}:18789`
  : 'https://api.realclaw.com';

export const WS_URL: string = __DEV__
  ? `ws://${DEV_HOST}:18789/ws`
  : 'wss://api.realclaw.com/ws';
