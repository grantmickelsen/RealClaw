import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { authedFetch } from './api';
import { useAuthStore } from '../store/auth';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function registerPushToken(): Promise<string | null> {
  if (!Device.isDevice) return null;  // simulators don't get push tokens

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') return null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  const tokenData = await Notifications.getExpoPushTokenAsync();
  const token = tokenData.data;

  // Register with backend
  const { userId } = useAuthStore.getState();
  if (userId) {
    try {
      await authedFetch('/v1/devices', {
        method: 'POST',
        body: JSON.stringify({
          userId,
          token,
          platform: Platform.OS as 'ios' | 'android',
        }),
      });
    } catch (err) {
      console.warn('[Push] Failed to register device token:', err);
    }
  }

  return token;
}

export async function setupNotificationHandlers(): Promise<void> {
  // Register categories for actionable notifications
  await Notifications.setNotificationCategoryAsync('APPROVAL', [
    { identifier: 'APPROVE', buttonTitle: 'Approve', options: { isDestructive: false } },
    { identifier: 'DENY',    buttonTitle: 'Deny',    options: { isDestructive: true } },
  ]);
}
