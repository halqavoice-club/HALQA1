/**
 * HALQA Mobile — Notifications
 *
 * Initializes push notification permissions, registers the FCM/APNS token,
 * and listens for token rotation (Requirement 16.6).
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
import api from './api';

/** SecureStore key for a pending FCM token that failed to upload. */
const PENDING_FCM_TOKEN_KEY = 'halqa_pending_fcm_token';

/**
 * Upload a push token to the backend. On failure, stores it in SecureStore
 * so it can be retried on the next app open.
 */
async function uploadPushToken(token: string): Promise<void> {
  try {
    await api.patch('/users/fcm-token', { fcmToken: token });
    // Clear any previously stored pending token since upload succeeded
    await SecureStore.deleteItemAsync(PENDING_FCM_TOKEN_KEY).catch(() => {});
  } catch {
    // Store for retry on next app open
    await SecureStore.setItemAsync(PENDING_FCM_TOKEN_KEY, token).catch(() => {});
  }
}

export async function initializeNotifications(): Promise<void> {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });

  if (!Device.isDevice) return;

  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') return;

    const tokenData = await Notifications.getExpoPushTokenAsync();
    if (tokenData?.data) {
      await api.put('/users/fcm-token', { token: tokenData.data }).catch(() => {});
    }

    // REQ-16.6: Listen for push token rotation (APNS / FCM may issue a new token
    // at any time). When it changes, send the new token to the backend within 5s.
    // If the request fails, the new token is stored in SecureStore for retry.
    Notifications.addPushTokenListener(async (updatedTokenData) => {
      if (updatedTokenData?.data) {
        await uploadPushToken(updatedTokenData.data);
      }
    });

    // REQ-16.6: Retry any pending FCM token from a previous failed upload
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
    // If notifications cannot be initialized, continue gracefully.
  }
}

export function onNotificationResponse(callback: (response: Notifications.NotificationResponse) => void) {
  return Notifications.addNotificationResponseReceivedListener(callback);
}
