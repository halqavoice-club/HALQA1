/**
 * useLeaveConfirmation
 *
 * Intercepts the Android hardware back button while mounted and shows a
 * confirmation dialog before navigating away. If the user confirms, the
 * provided `onLeave` callback is invoked. If they dismiss, the screen
 * stays open with no side effects.
 *
 * Requirements: 15.6, 15.7, 15.8
 *
 * Usage:
 *   useLeaveConfirmation(handleLeave, 'Leave this session?')
 *
 * Notes:
 * - Returns `true` from the BackHandler listener to consume the event and
 *   prevent the default Android back navigation.
 * - Only active when `active` is true (default). Pass `active={false}` to
 *   skip the guard when not yet joined or when the screen is wrapping up.
 */
import { useEffect } from 'react';
import { BackHandler, Alert } from 'react-native';

export function useLeaveConfirmation(
  onLeave: () => void,
  message = 'Leave this session?',
  active = true,
): void {
  useEffect(() => {
    if (!active) return;

    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      Alert.alert(
        'Leave',
        message,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Leave',
            style: 'destructive',
            onPress: onLeave,
          },
        ],
      );
      return true; // consumed — prevents default back navigation (Req 15.8)
    });

    return () => sub.remove();
  }, [onLeave, message, active]);
}
