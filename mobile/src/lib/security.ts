import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
import { getBaseURL } from './api';

const SCREEN_CAPTURE_PROTECTION_KEY = 'halqa_screen_capture_protection';

export function isLikelyCompromisedDevice(): boolean {
  const deviceName = Device.deviceName?.toLowerCase() || '';
  const modelName = Device.modelName?.toLowerCase() || '';
  const isEmulator = !Device.isDevice;
  const emulatorIndicators = ['simulator', 'emulator', 'sdk_gphone', 'google_sdk', 'android sdk built for x86'];
  const matchedEmulator = emulatorIndicators.some(keyword => deviceName.includes(keyword) || modelName.includes(keyword));
  return isEmulator || matchedEmulator;
}

export async function setScreenCaptureProtectionEnabled(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(SCREEN_CAPTURE_PROTECTION_KEY, enabled ? '1' : '0');
}

export async function isScreenCaptureProtectionEnabled(): Promise<boolean> {
  const stored = await SecureStore.getItemAsync(SCREEN_CAPTURE_PROTECTION_KEY);
  return stored === '1';
}

export function verifySecureUrl(url: string): string {
  const normalized = url.trim();
  if (!normalized.startsWith('https://') && !normalized.startsWith('halqa://')) {
    throw new Error('Only secure HTTPS or halqa:// URLs are allowed');
  }

  try {
    const parsed = new URL(normalized);
    const allowedHosts = [new URL(getBaseURL()).host, 'halqa.app'];
    if (!allowedHosts.includes(parsed.host)) {
      throw new Error('URL host is not trusted');
    }
    return parsed.toString();
  } catch (error) {
    throw new Error('Invalid URL');
  }
}
