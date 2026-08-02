/**
 * useScreenProtection
 *
 * Prevents screenshots and screen recording while the calling screen is mounted.
 * Use this hook in any financial or sensitive screen (buy-coins, wallet-history,
 * payout-request) to satisfy MOB-003 / Requirements 15.3–15.4.
 */
import { useEffect } from 'react';
import * as ScreenCapture from 'expo-screen-capture';

export function useScreenProtection(): void {
  useEffect(() => {
    ScreenCapture.preventScreenCaptureAsync();
    return () => {
      ScreenCapture.allowScreenCaptureAsync();
    };
  }, []);
}
