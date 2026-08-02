import { useEffect } from 'react';
import * as Updates from 'expo-updates';
import * as ScreenCapture from 'expo-screen-capture';
import { captureException, setupCrashReporting, initPerformanceMonitoring } from './monitoring';
import { initializeNotifications } from './notifications';
import { syncPendingActions } from './offline';
import { isBiometricSupported, authenticateBiometric, isBiometricEnabled } from './biometrics';
import { isLikelyCompromisedDevice } from './security';
import { logEvent } from './analytics';

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
}

export async function requireBiometricLogin(): Promise<boolean> {
  if (!(await isBiometricSupported()) || !(await isBiometricEnabled())) return false;
  return authenticateBiometric();
}
