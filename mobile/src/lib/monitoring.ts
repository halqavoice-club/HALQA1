import * as Application from 'expo-application';
import * as Updates from 'expo-updates';
import api from './api';
import { isOnline } from './offline';
import { logEvent } from './analytics';

export async function captureException(error: Error, context?: Record<string, any>) {
  const payload = {
    message: error.message,
    stack: error.stack,
    name: error.name,
    context: context ?? {},
    appVersion: Application.nativeApplicationVersion || Updates.manifest?.version || 'unknown',
    runtimeVersion: Updates.runtimeVersion || 'unknown',
    platform: Application.nativeApplicationVersion || 'unknown',
    timestamp: new Date().toISOString(),
  };

  await logEvent('crash_reported', payload);

  if (!(await isOnline())) return;

  try {
    await api.post('/telemetry/mobile-crash', payload);
  } catch {
    // Avoid blocking the app if crash report cannot be sent.
  }
}

export function setupCrashReporting() {
  if (typeof ErrorUtils !== 'undefined' && ErrorUtils.getGlobalHandler) {
    const originalHandler = ErrorUtils.getGlobalHandler();
    ErrorUtils.setGlobalHandler(async (error, isFatal) => {
      await captureException(error, { isFatal });
      originalHandler(error, isFatal);
    });
  }

  if (typeof global !== 'undefined' && 'addEventListener' in global) {
    try {
      // @ts-ignore
      global.addEventListener('unhandledrejection', async (event) => {
        if (event?.reason instanceof Error) {
          await captureException(event.reason, { type: 'unhandledrejection' });
        }
      });
    } catch {
      // no-op
    }
  }
}

export async function initPerformanceMonitoring() {
  try {
    logEvent('performance_monitoring_enabled');
  } catch {
    // If performance monitoring is unavailable, continue.
  }
}
