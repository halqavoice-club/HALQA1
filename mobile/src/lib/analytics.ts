import api from './api';
import { getStoredJSON, setStoredJSON, getStoredBoolean, setStoredBoolean } from './storage';
import { isOnline } from './offline';

const ANALYTICS_QUEUE_KEY = 'halqa_analytics_queue';
const ANALYTICS_ENABLED_KEY = 'halqa_analytics_enabled';

export interface AnalyticsEvent {
  name: string;
  params?: Record<string, any>;
  timestamp: number;
}

export async function setAnalyticsEnabled(value: boolean) {
  setStoredBoolean(ANALYTICS_ENABLED_KEY, value);
}

export async function isAnalyticsEnabled(): Promise<boolean> {
  return getStoredBoolean(ANALYTICS_ENABLED_KEY, true);
}

export async function logEvent(name: string, params: Record<string, any> = {}) {
  if (!(await isAnalyticsEnabled())) return;
  const event: AnalyticsEvent = { name, params, timestamp: Date.now() };
  const queue = getStoredJSON<AnalyticsEvent[]>(ANALYTICS_QUEUE_KEY) ?? [];
  setStoredJSON(ANALYTICS_QUEUE_KEY, [...queue, event]);
  flushAnalytics().catch(() => {});
}

export async function flushAnalytics() {
  if (!(await isAnalyticsEnabled()) || !(await isOnline())) return;

  const queue = getStoredJSON<AnalyticsEvent[]>(ANALYTICS_QUEUE_KEY) ?? [];
  if (!queue.length) return;

  try {
    await api.post('/analytics/events', { events: queue });
    setStoredJSON(ANALYTICS_QUEUE_KEY, []);
  } catch (error) {
    // keep queue and retry later
  }
}

export async function trackScreen(screenName: string) {
  await logEvent('screen_view', { screenName });
}
