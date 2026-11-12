import { useEffect } from 'react';
import { captureException, setupCrashReporting, initPerformanceMonitoring } from './monitoring';
import { initializeNotifications } from './notifications';
import { syncPendingActions } from './offline';
import { isBiometricSupported, authenticateBiometric, isBiometricEnabled } from './biometrics';
import { isLikelyCompromisedDevice } from './security';
import { logEvent } from './analytics';
import { getSocket } from './socket';
import { showMessage } from 'react-native-flash-message';
import { useSchoolStore } from '@/store/school.store';
import { useNotificationsStore } from '@/store/notifications.store';

export function useAppLifecycle() {
  useEffect(() => {
    setupCrashReporting();
    initializeNotifications().catch(() => {});
    initPerformanceMonitoring().catch(() => {});
    syncPendingActions().catch(() => {});

    const detectCompromise = async () => {
      if (isLikelyCompromisedDevice()) {
        await captureException(new Error('Potential compromised device detected'), { compromised: true });
      }
    };
    detectCompromise();
  }, []);

  // ── School join-request notification for admins ─────────────────────────
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handler = (data: any) => {
      // Only notify if this school is the user's active school
      const activeSchoolId = useSchoolStore.getState().activeSchoolId;
      const myMembership   = useSchoolStore.getState().memberships.find(
        m => m.schoolId === data?.schoolId && m.status === 'ACTIVE'
      );
      if (!myMembership || myMembership.role !== 'SCHOOL_ADMIN') return;

      // Show flash banner
      showMessage({
        message: `New join request — ${data?.schoolName ?? 'Your School'}`,
        description: `${data?.userName ?? 'A user'} wants to join as ${(data?.role ?? 'member').toLowerCase()}`,
        type: 'warning',
        duration: 6000,
        icon: 'warning',
      });

      // Bump notification badge
      useNotificationsStore.getState().incrementUnread();
    };

    // Register the event listener for the current connection.
    socket.on('school:join_request', handler);

    // On every reconnect, re-register the listener so it remains live
    // after the socket re-establishes. Socket.IO removes listeners only on
    // socket.off() — they survive a disconnect/reconnect on the SAME instance.
    // However, if initSocket() was called with a new instance, this effect's
    // closure still holds the original socket ref. The 'connect' listener below
    // ensures the handler re-attaches correctly on that instance.
    const onConnect = () => {
      socket.off('school:join_request', handler);
      socket.on('school:join_request', handler);
    };
    socket.on('connect', onConnect);

    return () => {
      socket.off('connect', onConnect);
      socket.off('school:join_request', handler);
    };
  // Run once on mount — socket ref is captured via getSocket() at call time.
  // getSocket() in the dep array would evaluate at render and change every time
  // initSocket() creates a new socket, causing the effect to re-run and churn listeners.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export async function requireBiometricLogin(): Promise<boolean> {
  if (!(await isBiometricSupported()) || !(await isBiometricEnabled())) return false;
  return authenticateBiometric();
}
