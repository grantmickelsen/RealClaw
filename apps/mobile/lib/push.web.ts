// Web stub — expo-notifications push token + category APIs are iOS/Android only.
// All functions are no-ops; the browser handles its own notification permissions
// separately and we have no backend push channel for web.

export async function registerPushToken(): Promise<string | null> {
  return null;
}

export async function setupNotificationHandlers(): Promise<void> {
  // no-op on web
}
