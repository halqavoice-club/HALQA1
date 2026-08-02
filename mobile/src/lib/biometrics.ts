import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

const BIOMETRIC_ENABLED_KEY = 'halqa_biometric_enabled';

export async function isBiometricSupported(): Promise<boolean> {
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const supportedTypes = await LocalAuthentication.supportedAuthenticationTypesAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    return hasHardware && enrolled && supportedTypes.length > 0;
  } catch {
    return false;
  }
}

export async function authenticateBiometric(): Promise<boolean> {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock HALQA',
      cancelLabel: 'Cancel',
      disableDeviceFallback: true,
      fallbackLabel: 'Use passcode',
    });
    return result.success;
  } catch {
    return false;
  }
}

export async function setBiometricEnabled(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(BIOMETRIC_ENABLED_KEY, enabled ? '1' : '0');
}

export async function isBiometricEnabled(): Promise<boolean> {
  const stored = await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY);
  return stored === '1';
}
