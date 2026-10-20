/**
 * HALQA Mobile — Notifications
 *
 * Initializes push notification permissions, registers the FCM/APNS token,
 * and listens for token rotation.
 *
 * Gracefully degrades in Expo Go where native push tokens aren't available.
 */
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
import api from './api';

/** SecureStore key for a pending FCM token that failed to upload. */
const PENDING_FCM_TOKEN_KEY = 'halqa_pending_fcm_token';

async function uploadPushToken(token: string): Promise<void> {
  try {
    await api.patch('/users/fcm-token', { fcmToken: token });
    await SecureStore.deleteItemAsync(PENDING_FCM_TOKEN_KEY).catch(() => {});
  } catch {
    await SecureStore.setItemAsync(PENDING_FCM_TOKEN_KEY, token).catch(() => {});
  }
}

export async function initializeNotifications(): Promise<void> {
  // expo-notifications push token requires a native development build.
  // In Expo Go (SDK 53+), remote push notifications are removed.
  // Skip gracefully — the app works fine without push tokens in Expo Go.
  try {
    // Dynamic import to avoid crashing at module level in Expo Go
    const Notifications = await import('expo-notifications');

    Notifications.setNotificationHandler({
      handleNotification: async () =>
        ({
          shouldShowAlert: true,
          shouldPlaySound: true,
          shouldSetBadge: true,
        } as any),
    });

    // Only initialize push tokens on real devices AND only in native builds
    // (not Expo Go — expo-notifications push was removed from Expo Go in SDK 53)
    if (!Device.isDevice) return;

    // Detect Expo Go — Constants.appOwnership === 'expo' means Expo Go
    const Constants = (await import('expo-constants')).default;
    const isExpoGo = Constants.appOwnership === 'expo';
    if (isExpoGo) return; // skip push token in Expo Go to avoid the SDK 53 crash

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') return;

    try {
      const tokenData = await Notifications.getExpoPushTokenAsync();
      if (tokenData?.data) {
        await api.put('/users/fcm-token', { token: tokenData.data }).catch(() => {});
      }
    } catch {
      // Push token not available — Expo Go without projectId configured
    }

    Notifications.addPushTokenListener(async (updatedTokenData) => {
      if (updatedTokenData?.data) {
        await uploadPushToken(updatedTokenData.data);
      }
    });

    const pendingToken = await SecureStore.getItemAsync(PENDING_FCM_TOKEN_KEY).catch(() => null);
    if (pendingToken) {
      await uploadPushToken(pendingToken);
    }

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#4f46e5',
      });
    }
  } catch {
    // Notifications not available in this environment — continue gracefully
  }
}

export function onNotificationResponse(callback: (response: any) => void): (() => void) {
  let unsub: (() => void) | null = null;
  import('expo-notifications').then(Notifications => {
    const sub = Notifications.addNotificationResponseReceivedListener(callback);
    unsub = () => sub.remove();
  }).catch(() => {});
  return () => unsub?.();
}
