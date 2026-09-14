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

    socket.on('school:join_request', handler);
    return () => { socket.off('school:join_request', handler); };
  // Re-subscribe whenever socket reconnects
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getSocket()]);
}

export async function requireBiometricLogin(): Promise<boolean> {
  if (!(await isBiometricSupported()) || !(await isBiometricEnabled())) return false;
  return authenticateBiometric();
}
