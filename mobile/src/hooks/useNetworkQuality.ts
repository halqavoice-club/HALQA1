/**
 * HALQA — useNetworkQuality (Phase 1: Network Detection)
 *
 * Monitors network quality in real time using NetInfo.
 * Returns a normalised quality level:
 *   'excellent' | 'good' | 'fair' | 'poor' | 'offline'
 *
 * Also provides raw NetInfo state and a lowDataMode flag that components
 * can read to reduce non-essential traffic.
 *
 * ADDITIVE ONLY — does not touch any existing file.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import NetInfo, { NetInfoState, NetInfoStateType } from '@react-native-community/netinfo';

export type NetworkQuality = 'excellent' | 'good' | 'fair' | 'poor' | 'offline';

export interface NetworkQualityState {
  quality: NetworkQuality;
  isConnected: boolean;
  type: string;               // wifi | cellular | ethernet | unknown | none
  effectiveType: string;      // 2g | 3g | 4g | 5g | unknown
  rtt: number | null;         // round-trip time in ms (cellular only)
  downlink: number | null;    // Mbps estimate (cellular only)
  lowDataMode: boolean;       // true when quality ≤ 'poor'
  isOffline: boolean;
}

// ─── Quality mapping ──────────────────────────────────────────────────────────
function toQuality(state: NetInfoState): NetworkQuality {
  if (!state.isConnected || (state.type as string) === 'none') return 'offline';
  if (state.type === NetInfoStateType.wifi || state.type === NetInfoStateType.ethernet) {
    // WiFi — check RTT if available
    const rtt = (state as any).details?.linkSpeed ?? null;
    if (rtt !== null && rtt < 5) return 'poor';    // < 5 Mbps link speed = poor WiFi
    return 'excellent';
  }
  if (state.type === NetInfoStateType.cellular) {
    const gen = (state as any).details?.cellularGeneration ?? null;
    if (gen === '2g')  return 'poor';
    if (gen === '3g')  return 'fair';
    if (gen === '4g')  return 'good';
    if (gen === '5g')  return 'excellent';
    // No generation info — use RTT heuristic
    const rtt = (state as any).details?.downlink ?? null;
    if (rtt !== null) {
      if (rtt < 0.1)  return 'poor';
      if (rtt < 1)    return 'fair';
      if (rtt < 5)    return 'good';
      return 'excellent';
    }
    return 'fair'; // unknown cellular → assume fair
  }
  if (!state.isInternetReachable) return 'poor';
  return 'fair';
}

const INITIAL_STATE: NetworkQualityState = {
  quality: 'good',
  isConnected: true,
  type: 'unknown',
  effectiveType: 'unknown',
  rtt: null,
  downlink: null,
  lowDataMode: false,
  isOffline: false,
};

export function useNetworkQuality(): NetworkQualityState {
  const [state, setState] = useState<NetworkQualityState>(INITIAL_STATE);

  const updateState = useCallback((netState: NetInfoState) => {
    const quality = toQuality(netState);
    setState({
      quality,
      isConnected:    netState.isConnected ?? false,
      type:           netState.type,
      effectiveType:  (netState as any).details?.cellularGeneration ?? 'unknown',
      rtt:            (netState as any).details?.downlink ?? null,
      downlink:       (netState as any).details?.downlink ?? null,
      lowDataMode:    quality === 'poor' || quality === 'offline',
      isOffline:      quality === 'offline',
    });
  }, []);

  useEffect(() => {
    // Get initial state
    NetInfo.fetch().then(updateState).catch(() => {});

    // Subscribe to changes
    const unsubscribe = NetInfo.addEventListener(updateState);
    return () => unsubscribe();
  }, [updateState]);

  return state;
}

// ─── Utility: map quality to LiveKit audio bitrate ───────────────────────────
export function qualityToAudioBitrate(quality: NetworkQuality): number {
  switch (quality) {
    case 'excellent': return 96_000;  // 96 kbps — best quality
    case 'good':      return 64_000;  // 64 kbps — standard
    case 'fair':      return 32_000;  // 32 kbps — voice-optimised
    case 'poor':      return 16_000;  // 16 kbps — minimum viable voice
    case 'offline':   return 16_000;
    default:          return 48_000;
  }
}

// ─── Utility: map quality to poll interval (ms) ──────────────────────────────
export function qualityToPollInterval(quality: NetworkQuality, basePollMs: number): number {
  switch (quality) {
    case 'excellent': return basePollMs;
    case 'good':      return basePollMs * 1.5;
    case 'fair':      return basePollMs * 2;
    case 'poor':      return basePollMs * 4;    // 60s instead of 15s
    case 'offline':   return 0;                 // pause polling
    default:          return basePollMs;
  }
}
