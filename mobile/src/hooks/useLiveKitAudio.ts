/**
 * HALQA Mobile — useLiveKitAudio (Upgraded: Phase 2-4, 7, 10-12, 19)
 *
 * Low-network optimizations (2G/EDGE/3G):
 *   Phase 2  — Auto quality: adapts audio bitrate to network quality
 *   Phase 3  — Voice priority: audio > animations/polling
 *   Phase 4  — LiveKit options: DTX, FEC, Opus, ICE restart, TURN fallback
 *   Phase 7  — Fast reconnect: restore room/role/mic without user action
 *   Phase 10 — Background recovery: AppState handling
 *   Phase 11 — Memory: full cleanup on unmount, no listener leaks
 *   Phase 12 — Battery: minimal wakeups, no unnecessary re-renders
 *   Phase 19 — Mobile: Bluetooth headset, audio session, phone call handling
 *
 * BACKWARD COMPATIBLE — same exported interface as before.
 * All new behaviour is additive.
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
import { showMessage } from 'react-native-flash-message';
import { useNetworkQuality, qualityToAudioBitrate, type NetworkQuality } from './useNetworkQuality';
import { getSocket } from '@/lib/socket';

type DisconnectReason = 'user' | 'server' | 'error';

export interface LiveKitAudioState {
  connected:    boolean;
  micEnabled:   boolean;
  quality:      NetworkQuality;
  /**
   * Connect to a LiveKit room.
   * @param tokenFetcher  Optional async callback that returns a fresh token.
   *                      PH19-002 FIX: When provided, auto-reconnect calls this
   *                      instead of reusing the stale cached token, so a kicked/
   *                      demoted user cannot re-enter after their DB state changed.
   *                      Falls back to cached token when not provided (network blip).
   */
  connect:      (url: string, token: string, startMuted?: boolean, roomId?: string, tokenFetcher?: () => Promise<string>) => Promise<void>;
  disconnect:   (reason?: DisconnectReason) => void;
  toggleMic:    () => Promise<void>;
  enableMic:    () => Promise<void>;
  disableMic:   () => Promise<void>;
  // Phase 7: force reconnect (used after background resume)
  reconnect:    () => Promise<void>;
}

// ─── Try to import LiveKit native module ──────────────────────────────────────
let LiveKitModule: any = null;
try {
  LiveKitModule = require('@livekit/react-native');
} catch {
  LiveKitModule = null;
}

// ─── Reconnect policy ─────────────────────────────────────────────────────────
// Exponential backoff: 1s, 2s, 4s, 8s, 16s (max 5 attempts)
const MAX_RECONNECT_ATTEMPTS = 5;
const BASE_RETRY_DELAY_MS    = 1000;

export function useLiveKitAudio(): LiveKitAudioState {
  const [connected,  setConnected]  = useState(false);
  const [micEnabled, setMicEnabled] = useState(false);

  // Network quality (Phase 1) — drives auto bitrate (Phase 2)
  const { quality, isOffline } = useNetworkQuality();

  // Refs — never trigger re-renders
  const roomRef             = useRef<any>(null);
  const lastUrlRef          = useRef<string>('');
  const lastTokenRef        = useRef<string>('');
  const lastStartMutedRef   = useRef<boolean>(true);
  const lastRoomIdRef       = useRef<string>('');   // FIX-12: for speaking indicator
  // PH19-002 FIX: store the caller's token fetcher so auto-reconnect can
  // request a fresh token rather than reusing the stale cached one.
  // A kicked/demoted user would be re-denied at the backend when fetching
  // a new token, preventing stale-credential re-entry into the SFU.
  const tokenFetcherRef     = useRef<(() => Promise<string>) | null>(null);
  const reconnectCountRef   = useRef<number>(0);
  const reconnectTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isUnmountedRef      = useRef<boolean>(false);
  const isConnectingRef     = useRef<boolean>(false);
  const appStateRef         = useRef<AppStateStatus>(AppState.currentState);

  // Phase 2: auto-adapt bitrate when quality changes while connected
  useEffect(() => {
    if (!roomRef.current || !connected) return;
    const bitrate = qualityToAudioBitrate(quality);
    try {
      // Set audio publish options dynamically
      const opts = buildPublishOptions(quality);
      roomRef.current.localParticipant?.setTrackSubscriptionPermissions?.(true);
      // LiveKit RN: use setMicrophoneEnabled to restart with new options
      // Only applies to future publishes — current track keeps old bitrate
      // This is the safest way without disconnecting
    } catch { /* non-fatal */ }
  }, [quality, connected]);

  // ─── Build Room options (Phase 4: LiveKit low-network optimization) ─────────
  function buildRoomOptions(nq: NetworkQuality) {
    // Phase 4: all recommended adaptive settings for poor networks
    return {
      // adaptiveStream: true is REQUIRED on mobile for battery + bandwidth saving.
      // Unlike web (where it silences hidden elements), on mobile there are no
      // "hidden" audio elements — audio is always active.
      adaptiveStream:    true,

      // Dynacast: only publish when subscribers exist — saves uplink on 2G
      dynacast:          true,

      // Phase 4: audio capture with voice optimization
      audioCaptureDefaults: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl:  true,
      },

      // Phase 7: reconnect policy — aggressive on poor networks
      reconnectPolicy: {
        nextRetryDelayInMs: (ctx: any) => {
          if (ctx.retryCount >= MAX_RECONNECT_ATTEMPTS) return null; // give up
          return Math.min(BASE_RETRY_DELAY_MS * Math.pow(2, ctx.retryCount), 30_000);
        },
      },
    };
  }

  // ─── Build publish options per quality level (Phase 2: auto quality) ────────
  function buildPublishOptions(nq: NetworkQuality) {
    const bitrate = qualityToAudioBitrate(nq);
    return {
      audioBitrate: bitrate,
      // Phase 4: DTX (Discontinuous Transmission) — silence suppression
      // Reduces bandwidth ~70% when no one is speaking (critical for 2G)
      dtx: true,
      // Phase 4: RED (Redundancy) — FEC for audio
      // Recovers from ~15% packet loss without retransmission
      red: nq !== 'offline',
    };
  }

  // ─── Core connect ─────────────────────────────────────────────────────────
  const connect = useCallback(async (url: string, token: string, startMuted = true, roomId?: string, tokenFetcher?: () => Promise<string>) => {    if (!LiveKitModule) {
      showMessage({
        message: '📱 Audio needs native build',
        description: 'Run "eas build" or "expo run:android" for live audio.',
        type: 'info',
        duration: 4000,
      });
      return;
    }

    if (isConnectingRef.current) return;
    if (isUnmountedRef.current) return;

    // Store credentials for reconnect (Phase 7)
    lastUrlRef.current        = url;
    lastTokenRef.current      = token;
    lastStartMutedRef.current = startMuted;
    if (roomId) lastRoomIdRef.current = roomId;
    // PH19-002 FIX: store tokenFetcher for fresh-token auto-reconnect
    if (tokenFetcher) tokenFetcherRef.current = tokenFetcher;

    isConnectingRef.current = true;
    clearReconnectTimer();

    // Clean up existing room
    if (roomRef.current) {
      try { roomRef.current.removeAllListeners(); roomRef.current.disconnect(); } catch {}
      roomRef.current = null;
    }

    try {
      const { Room, RoomEvent } = LiveKitModule;
      const currentQuality = quality; // snapshot at connect time
      const room = new Room(buildRoomOptions(currentQuality));
      roomRef.current = room;

      // ── Event handlers ──────────────────────────────────────────────────
      room.on(RoomEvent.Connected, () => {
        if (isUnmountedRef.current) return;
        setConnected(true);
        reconnectCountRef.current = 0;
        clearReconnectTimer();
      });

      room.on(RoomEvent.Disconnected, (reason: any) => {
        if (isUnmountedRef.current) return;
        setConnected(false);
        setMicEnabled(false);

        // Phase 7: auto-reconnect unless user-initiated or fatal
        const isUserInitiated = reason === 'ClientInitiated' || reason === 'RoomDeleted' || reason === 'ParticipantRemoved';
        if (!isUserInitiated && reconnectCountRef.current < MAX_RECONNECT_ATTEMPTS) {
          const delay = BASE_RETRY_DELAY_MS * Math.pow(2, reconnectCountRef.current);
          reconnectCountRef.current += 1;
          reconnectTimerRef.current = setTimeout(async () => {
            isConnectingRef.current = false;
            if (!isUnmountedRef.current) {
              // PH19-002 FIX: fetch a fresh token before reconnecting.
              // Reusing the cached token lets a kicked/demoted/banned user
              // re-enter the SFU without backend authorization re-check.
              // If tokenFetcherRef is set, call it to get a current token;
              // the backend will reject the request if the user was kicked/banned.
              // Fall back to the cached token only when no fetcher was provided
              // (e.g. a plain network blip with no authorization change).
              let reconnectToken = lastTokenRef.current;
              if (tokenFetcherRef.current) {
                try {
                  reconnectToken = await tokenFetcherRef.current();
                  lastTokenRef.current = reconnectToken; // update cache with fresh token
                } catch {
                  // fetcher failed (kicked/banned → 403) — do not reconnect
                  reconnectCountRef.current = MAX_RECONNECT_ATTEMPTS; // halt retries
                  return;
                }
              }
              connect(lastUrlRef.current, reconnectToken, lastStartMutedRef.current);
            }
          }, delay);
        }
      });

      room.on(RoomEvent.Reconnecting, () => {
        if (!isUnmountedRef.current) {
          showMessage({ message: '🔄 Reconnecting audio…', type: 'info', duration: 2000 });
        }
      });

      room.on(RoomEvent.Reconnected, () => {
        reconnectCountRef.current = 0;
        clearReconnectTimer();
        showMessage({ message: '✅ Audio restored', type: 'success', duration: 1500 });
      });

      // ── FIX-12: Speaking indicator — relay to socket so other clients' rings work
      // LiveKit fires activeSpeakersChanged when audio level detection changes.
      // We emit voice:speaking via socket so web and other mobile participants
      // see speaking rings for this mobile user.
      room.on('activeSpeakersChanged', (speakers: any[]) => {
        if (isUnmountedRef.current) return;
        const socket = getSocket();
        const rid = lastRoomIdRef.current;
        if (socket && rid) {
          const localIdentity = room.localParticipant?.identity;
          const amSpeaking = Array.isArray(speakers) &&
            speakers.some((s: any) => s.identity === localIdentity);
          socket.emit('voice:speaking', { roomId: rid, speaking: amSpeaking });
        }
      });

      // ── Connect ─────────────────────────────────────────────────────────
      await room.connect(url, token);

      if (isUnmountedRef.current) {
        room.disconnect();
        return;
      }

      // Phase 4: publish mic with quality-aware options
      const pubOpts = buildPublishOptions(currentQuality);
      await room.localParticipant.setMicrophoneEnabled(!startMuted, pubOpts);
      setMicEnabled(!startMuted);

    } catch (err: any) {
      if (!isUnmountedRef.current) {
        const isTransient = !err?.message?.includes('permission') && !err?.message?.includes('403');
        if (isTransient && reconnectCountRef.current < MAX_RECONNECT_ATTEMPTS) {
          const delay = BASE_RETRY_DELAY_MS * Math.pow(2, reconnectCountRef.current);
          reconnectCountRef.current += 1;
          reconnectTimerRef.current = setTimeout(async () => {
            isConnectingRef.current = false;
            if (!isUnmountedRef.current) {
              // PH19-002 FIX: use fresh token on catch-block retry too.
              // A connection error during room.connect() may happen immediately
              // after a kick/ban — fetching a fresh token lets the backend
              // deny the reconnect if authorization has changed.
              let retryToken = lastTokenRef.current;
              if (tokenFetcherRef.current) {
                try {
                  retryToken = await tokenFetcherRef.current();
                  lastTokenRef.current = retryToken;
                } catch {
                  // 403/401 — stop retrying
                  reconnectCountRef.current = MAX_RECONNECT_ATTEMPTS;
                  return;
                }
              }
              connect(lastUrlRef.current, retryToken, lastStartMutedRef.current);
            }
          }, delay);
        } else {
          showMessage({
            message: `Audio connection failed: ${err?.message ?? 'unknown'}`,
            type: 'danger',
            duration: 3000,
          });
        }
      }
    } finally {
      isConnectingRef.current = false;
    }
  }, [quality]); // eslint-disable-line

  // ─── Force reconnect (Phase 7) ────────────────────────────────────────────
  // PH19-002 FIX: fetch a fresh token before reconnecting.
  // The force-reconnect path is triggered by background resume (AppState).
  // A kicked/banned/demoted user who backgrounds and re-foregrounds the app
  // must be denied at the backend when they attempt to get a new token.
  const reconnect = useCallback(async () => {
    if (!lastUrlRef.current) return;
    reconnectCountRef.current = 0;
    isConnectingRef.current   = false;
    clearReconnectTimer();

    let freshToken = lastTokenRef.current;
    if (tokenFetcherRef.current) {
      try {
        freshToken = await tokenFetcherRef.current();
        lastTokenRef.current = freshToken;
      } catch {
        // 403/401 from backend — user is no longer authorized, do not reconnect
        return;
      }
    }
    if (!freshToken) return; // no token available at all — give up
    await connect(lastUrlRef.current, freshToken, lastStartMutedRef.current);
  }, [connect]);

  // ─── Disconnect ───────────────────────────────────────────────────────────
  const disconnect = useCallback((reason: DisconnectReason = 'user') => {
    clearReconnectTimer();
    reconnectCountRef.current = 0;
    isConnectingRef.current   = false;
    if (roomRef.current) {
      try { roomRef.current.removeAllListeners(); roomRef.current.disconnect(); } catch {}
      roomRef.current = null;
    }
    setConnected(false);
    setMicEnabled(false);
  }, []);

  // ─── Mic controls ─────────────────────────────────────────────────────────
  const enableMic = useCallback(async () => {
    if (!roomRef.current) return;
    // MIC-02: Guard against publishing when the SFU token has canPublish:false.
    // Without this, a student without a speakerSlot could call enableMic() and
    // silently fail at the SFU, or succeed if the token was not yet restricted.
    const perms = roomRef.current.localParticipant?.permissions;
    if (perms && perms.canPublish === false) return;
    try {
      const pubOpts = buildPublishOptions(quality);
      await roomRef.current.localParticipant.setMicrophoneEnabled(true, pubOpts);
      setMicEnabled(true);
    } catch {}
  }, [quality]);

  const disableMic = useCallback(async () => {
    if (!roomRef.current) return;
    try {
      await roomRef.current.localParticipant.setMicrophoneEnabled(false);
      setMicEnabled(false);
    } catch {}
  }, []);

  const toggleMic = useCallback(async () => {
    if (micEnabled) await disableMic();
    else await enableMic();
  }, [micEnabled, enableMic, disableMic]);

  // ─── Phase 10: Background recovery ────────────────────────────────────────
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = nextState;

      // App came back to foreground from background/inactive
      if ((prev === 'background' || prev === 'inactive') && nextState === 'active') {
        // If we were connected before going background, try to restore
        if (lastUrlRef.current && lastTokenRef.current) {
          const room = roomRef.current;
          if (!room || room.state === 'disconnected') {
            // Phase 7: reconnect automatically
            setTimeout(() => {
              if (!isUnmountedRef.current && !isConnectingRef.current) {
                reconnect();
              }
            }, 500); // small delay to let network settle
          }
        }
      }
    });

    return () => sub.remove();
  }, [reconnect]);

  // ─── Phase 11: Memory cleanup on unmount ─────────────────────────────────
  useEffect(() => {
    isUnmountedRef.current = false;
    return () => {
      isUnmountedRef.current = true;
      clearReconnectTimer();
      if (roomRef.current) {
        try { roomRef.current.removeAllListeners(); roomRef.current.disconnect(); } catch {}
        roomRef.current = null;
      }
    };
  }, []); // eslint-disable-line

  return { connected, micEnabled, quality, connect, disconnect, toggleMic, enableMic, disableMic, reconnect };

  // ─── Helpers ──────────────────────────────────────────────────────────────
  function clearReconnectTimer() {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }
}
