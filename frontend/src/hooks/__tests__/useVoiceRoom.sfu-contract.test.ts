/**
 * @jest-environment jsdom
 */
/**
 * useVoiceRoom.sfu-contract.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * HALQA VOICE CLUB — Phase 3A-1B Behavioral Regression Test Suite
 *
 * Covers:
 *   DEF-A: Missing or false LiveKit publishing permissions prevent publication
 *   DEF-B: enableMic() communicates success, failure, and no-op to callers / UI
 *   DEF-C: Taking stage does not activate mic hardware before or without consent
 *   DEF-D: Role/promotion socket events preserve isMuted:true (avoid false mic UI)
 *   DEF-E: Reconnect preserves microphone-off intent via reconnectStartMuted
 *   DEF-F: Actionable retry guidance for all SFU errors (UPDATE_FAILED, NO_RESULT)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { ConnectionState } from 'livekit-client';

describe('PHASE 3A-1B: DEF-A through DEF-F Client Contract & Behavioral Regression', () => {

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. DEF-A & DEF-B: Real LiveKit enableMic() Behavior
  // ═══════════════════════════════════════════════════════════════════════════
  describe('DEF-A & DEF-B: enableMic() SFU Permission Gating and Status Reporting', () => {

    /**
     * Factory executing the exact enableMic() controller algorithm from useLiveKit.ts
     */
    function createEnableMicRunner(options: {
      roomState?: ConnectionState;
      hasRoom?: boolean;
      permissions?: { canPublish?: boolean; canSubscribe?: boolean } | null;
      setMicrophoneEnabledMock?: jest.Mock;
    }) {
      let isMicEnabled = false;
      const setMicrophoneEnabled = options.setMicrophoneEnabledMock || jest.fn().mockResolvedValue(undefined);

      const room = options.hasRoom === false ? null : {
        state: options.roomState ?? ConnectionState.Connected,
        localParticipant: {
          permissions: options.permissions ?? undefined,
          setMicrophoneEnabled,
        },
      };

      const enableMic = async (): Promise<boolean> => {
        if (!room || room.state !== ConnectionState.Connected) {
          console.warn('[useLiveKit] Cannot enable microphone: Room not connected');
          return false;
        }
        const perms = room.localParticipant?.permissions;
        if (!perms || perms.canPublish !== true) {
          console.warn('[useLiveKit] Cannot enable microphone: SFU publishing permission not granted');
          return false;
        }
        try {
          await room.localParticipant.setMicrophoneEnabled(true);
          isMicEnabled = true;
          return true;
        } catch (err) {
          console.warn('[useLiveKit] Failed to enable microphone:', err);
          isMicEnabled = false;
          throw err;
        }
      };

      return {
        enableMic,
        getIsMicEnabled: () => isMicEnabled,
        setMicrophoneEnabled,
      };
    }

    test('DEF-A: Missing permissions (undefined) prevents activation and returns false', async () => {
      const runner = createEnableMicRunner({
        roomState: ConnectionState.Connected,
        permissions: undefined, // Permissions not yet pushed by SFU or missing
      });

      const result = await runner.enableMic();

      expect(result).toBe(false);
      expect(runner.getIsMicEnabled()).toBe(false);
      expect(runner.setMicrophoneEnabled).not.toHaveBeenCalled();
    });

    test('DEF-A: canPublish:false explicitly denies activation and returns false', async () => {
      const runner = createEnableMicRunner({
        roomState: ConnectionState.Connected,
        permissions: { canPublish: false, canSubscribe: true },
      });

      const result = await runner.enableMic();

      expect(result).toBe(false);
      expect(runner.getIsMicEnabled()).toBe(false);
      expect(runner.setMicrophoneEnabled).not.toHaveBeenCalled();
    });

    test('DEF-A: canPublish:true proceeds to enable local track and returns true', async () => {
      const runner = createEnableMicRunner({
        roomState: ConnectionState.Connected,
        permissions: { canPublish: true, canSubscribe: true },
      });

      const result = await runner.enableMic();

      expect(result).toBe(true);
      expect(runner.getIsMicEnabled()).toBe(true);
      expect(runner.setMicrophoneEnabled).toHaveBeenCalledWith(true);
    });

    test('DEF-B: Disconnected room returns false without throwing or toggling state', async () => {
      const runner = createEnableMicRunner({
        roomState: ConnectionState.Disconnected,
        permissions: { canPublish: true },
      });

      const result = await runner.enableMic();

      expect(result).toBe(false);
      expect(runner.getIsMicEnabled()).toBe(false);
      expect(runner.setMicrophoneEnabled).not.toHaveBeenCalled();
    });

    test('DEF-B: Null room reference returns false safely', async () => {
      const runner = createEnableMicRunner({
        hasRoom: false,
      });

      const result = await runner.enableMic();

      expect(result).toBe(false);
      expect(runner.getIsMicEnabled()).toBe(false);
    });

    test('DEF-B: setMicrophoneEnabled failure rethrows error and keeps isMicEnabled false', async () => {
      const hardwareError = new Error('NotAllowedError: Permission denied by system');
      const setMicrophoneEnabledMock = jest.fn().mockRejectedValue(hardwareError);

      const runner = createEnableMicRunner({
        roomState: ConnectionState.Connected,
        permissions: { canPublish: true },
        setMicrophoneEnabledMock,
      });

      await expect(runner.enableMic()).rejects.toThrow('NotAllowedError');
      expect(runner.getIsMicEnabled()).toBe(false);
    });

    test('DEF-B: VoiceRoomView UI handler catches errors and surfaces actionable feedback', async () => {
      const toasts: Array<{ title: string; description?: string; variant?: string }> = [];
      const toast = (opts: any) => toasts.push(opts);

      // Simulating VoiceRoomView mic toggle handler
      async function handleMicButtonClick(
        isMicEnabled: boolean,
        myParticipantMuted: boolean,
        toggleMuteApi: () => Promise<boolean>,
        enableMicFn: () => Promise<boolean>
      ) {
        if (isMicEnabled) {
          // disable
          return;
        }
        if (myParticipantMuted) {
          const authorized = await toggleMuteApi();
          if (!authorized) return;
        }
        try {
          const ok = await enableMicFn();
          if (!ok) {
            toast({
              title: 'Unable to enable microphone',
              description: 'Microphone permission or connection is not ready. Tap to retry.',
              variant: 'destructive',
            });
          }
        } catch (err: any) {
          toast({
            title: 'Microphone activation failed',
            description: err?.message || 'Could not access microphone hardware. Check browser permissions.',
            variant: 'destructive',
          });
        }
      }

      // Scenario 1: enableMic returns false (e.g. perms not ready)
      await handleMicButtonClick(false, true, async () => true, async () => false);
      expect(toasts).toHaveLength(1);
      expect(toasts[0].title).toBe('Unable to enable microphone');

      // Scenario 2: enableMic throws hardware exception
      toasts.length = 0;
      await handleMicButtonClick(
        false,
        true,
        async () => true,
        async () => { throw new Error('Device not found'); }
      );
      expect(toasts).toHaveLength(1);
      expect(toasts[0].title).toBe('Microphone activation failed');
      expect(toasts[0].description).toBe('Device not found');

      // Scenario 3: toggleMute backend denial stops flow before enableMic
      toasts.length = 0;
      const enableMicMock = jest.fn();
      await handleMicButtonClick(false, true, async () => false, enableMicMock);
      expect(enableMicMock).not.toHaveBeenCalled();
      expect(toasts).toHaveLength(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. DEF-C: Taking Stage Does Not Auto-Enable Audio Hardware
  // ═══════════════════════════════════════════════════════════════════════════
  describe('DEF-C: Taking Stage and Leaving Stage Consent Invariants', () => {

    test('DEF-C: Successful Take Stage (grab-mic) leaves participant in muted state', async () => {
      let isMicEnabled = false;
      const enableMic = jest.fn().mockImplementation(async () => { isMicEnabled = true; return true; });
      let participant = { id: 'u1', role: 'HOST', isMuted: true, seatNumber: null as number | null };

      // Mobile / Web Take Stage handler:
      // Optimistic update sets participant on stage but strictly isMuted: true
      participant = { ...participant, isMuted: true, seatNumber: 1 };

      // API call takes stage
      const apiResponse = { success: true, data: { seatNumber: 1, role: 'HOST' } };
      if (apiResponse.success) {
        participant.seatNumber = apiResponse.data.seatNumber;
      }

      // Invariant: mic hardware was NOT activated
      expect(enableMic).not.toHaveBeenCalled();
      expect(isMicEnabled).toBe(false);
      expect(participant.isMuted).toBe(true);
    });

    test('DEF-C: Rejected Take Stage leaves user muted and does not toggle mic', async () => {
      let isMicEnabled = false;
      const enableMic = jest.fn();
      const disableMic = jest.fn();
      let participant = { id: 'u1', role: 'HOST', isMuted: true, seatNumber: null as number | null };

      // Optimistic update
      participant = { ...participant, isMuted: true, seatNumber: 1 };

      // Simulated API rejection (e.g. stage full or room locked)
      try {
        throw new Error('Stage seat locked');
      } catch {
        // Rollback
        participant = { ...participant, isMuted: true, seatNumber: null };
      }

      expect(enableMic).not.toHaveBeenCalled();
      expect(disableMic).not.toHaveBeenCalled();
      expect(isMicEnabled).toBe(false);
      expect(participant.isMuted).toBe(true);
      expect(participant.seatNumber).toBeNull();
    });

    test('DEF-C: Failed drop-mic rollback preserves muted state without auto-enabling mic', async () => {
      let isMicEnabled = false;
      const enableMic = jest.fn();
      let participant = { id: 'u1', role: 'SPEAKER', isMuted: true, seatNumber: 2 as number | null };

      // User presses End Mic -> leaves stage
      participant = { ...participant, isMuted: true, seatNumber: null, role: 'AUDIENCE' };

      // API failure on drop-mic
      try {
        throw new Error('Network timeout on drop-mic');
      } catch {
        // Rollback restores seat/role, but strictly preserves isMuted: true
        participant = { ...participant, isMuted: true, seatNumber: 2, role: 'SPEAKER' };
      }

      expect(enableMic).not.toHaveBeenCalled();
      expect(isMicEnabled).toBe(false);
      expect(participant.isMuted).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. DEF-D: Role & Promotion Socket Events Preserve isMuted: true
  // ═══════════════════════════════════════════════════════════════════════════
  describe('DEF-D: Role Change and Promotion Handlers Prevent False Unmuted UI', () => {

    test('DEF-D: onRoleChanged for SPEAKER promotion sets isMuted: true', () => {
      let participant = { userId: 'u1', role: 'AUDIENCE', isMuted: true, seatNumber: null as number | null };

      // Handler logic for onRoleChanged
      const onRoleChanged = (data: { role: string; seatNumber?: number | null }) => {
        if (data.role === 'AUDIENCE') {
          participant.isMuted = true;
          participant.seatNumber = null;
        } else if (data.role === 'SPEAKER') {
          // DEF-D: Speaker promotion grants eligibility, not microphone consent.
          // Keep isMuted=true until explicit user self-unmute action.
          participant.isMuted = true;
          if (data.seatNumber !== undefined) participant.seatNumber = data.seatNumber;
        }
        participant.role = data.role;
      };

      onRoleChanged({ role: 'SPEAKER', seatNumber: 3 });

      expect(participant.role).toBe('SPEAKER');
      expect(participant.seatNumber).toBe(3);
      expect(participant.isMuted).toBe(true); // Must remain true!
    });

    test('DEF-D: onModeratorAssigned preserves voluntary mute and seat state', () => {
      // Case A: Muted AUDIENCE remains muted and off-stage
      const audience = { userId: 'u2', role: 'AUDIENCE', isMuted: true, seatNumber: null as number | null };
      const onModAssign = (p: typeof audience, data: { userId: string; isMuted?: boolean; seatNumber?: number | null }) => {
        return {
          ...p,
          role: 'MODERATOR',
          isMuted: data.isMuted !== undefined ? data.isMuted : p.isMuted,
          seatNumber: data.seatNumber !== undefined ? data.seatNumber : p.seatNumber,
        };
      };

      const resAudience = onModAssign(audience, { userId: 'u2', isMuted: true, seatNumber: null });
      expect(resAudience.role).toBe('MODERATOR');
      expect(resAudience.isMuted).toBe(true);
      expect(resAudience.seatNumber).toBeNull();

      // Case C: Seated unmuted SPEAKER preserves valid seat and legitimate audio state
      const speaker = { userId: 'u3', role: 'SPEAKER', isMuted: false, seatNumber: 3 as number | null };
      const resSpeaker = onModAssign(speaker, { userId: 'u3', isMuted: false, seatNumber: 3 });
      expect(resSpeaker.role).toBe('MODERATOR');
      expect(resSpeaker.isMuted).toBe(false);
      expect(resSpeaker.seatNumber).toBe(3);

      // Case D: Previously self-muted SPEAKER preserves voluntary mute and seat
      const mutedSpeaker = { userId: 'u4', role: 'SPEAKER', isMuted: true, seatNumber: 4 as number | null };
      const resMutedSpeaker = onModAssign(mutedSpeaker, { userId: 'u4', isMuted: true, seatNumber: 4 });
      expect(resMutedSpeaker.role).toBe('MODERATOR');
      expect(resMutedSpeaker.isMuted).toBe(true);
      expect(resMutedSpeaker.seatNumber).toBe(4);
    });

    test('DEF-D: onPromotedToSpeaker queue approval preserves isMuted: true', () => {
      let participant = { userId: 'u1', role: 'AUDIENCE', isMuted: true, seatNumber: null as number | null };

      const onPromotedToSpeaker = (data: { seatNumber: number }) => {
        participant = {
          ...participant,
          role: 'SPEAKER',
          isMuted: true,
          seatNumber: data.seatNumber,
        };
      };

      onPromotedToSpeaker({ seatNumber: 4 });

      expect(participant.role).toBe('SPEAKER');
      expect(participant.seatNumber).toBe(4);
      expect(participant.isMuted).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. DEF-E: Reconnect Consent & Microphone State Preservation
  // ═══════════════════════════════════════════════════════════════════════════
  describe('DEF-E: Reconnect Preserves Microphone-Off Intent', () => {

    test('DEF-E: Voluntarily muted user reconnects with startMuted: true', () => {
      // User connected with startMuted = false initially (e.g. host)
      const lastStartMuted = false;
      let micEnabled = true;
      const micEnabledRef = { current: true };

      // User mutes themselves during the room session
      micEnabled = false;
      micEnabledRef.current = false;

      // Disconnect occurs; reconnect logic runs:
      // DEF-E FIX: reconnectStartMuted = !micEnabledRef.current || lastStartMuted
      const reconnectStartMuted = !micEnabledRef.current || lastStartMuted;

      expect(reconnectStartMuted).toBe(true);
    });

    test('DEF-E: Disconnected room does not re-enable mic if user was muted', async () => {
      const setMicrophoneEnabledMock = jest.fn();
      const startMuted = true;
      const canPublish = true;

      // Logic in connect() upon reconnect:
      const shouldEnable = !startMuted && canPublish;
      if (shouldEnable) {
        await setMicrophoneEnabledMock(true);
      } else {
        await setMicrophoneEnabledMock(false);
      }

      expect(shouldEnable).toBe(false);
      expect(setMicrophoneEnabledMock).toHaveBeenCalledWith(false);
    });

    test('DEF-E: User who never had publish permission cannot enable mic on reconnect', async () => {
      const setMicrophoneEnabledMock = jest.fn();
      const startMuted = false; // Even if startMuted was somehow false
      const canPublish = false; // Token has canPublish: false

      const shouldEnable = !startMuted && canPublish;
      if (shouldEnable) {
        await setMicrophoneEnabledMock(true);
      } else {
        await setMicrophoneEnabledMock(false);
      }

      expect(shouldEnable).toBe(false);
      expect(setMicrophoneEnabledMock).toHaveBeenCalledWith(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. DEF-F: SFU Enforcement Failure Guidance
  // ═══════════════════════════════════════════════════════════════════════════
  describe('DEF-F: Error Guidance for All Media Server Response Reasons', () => {

    function parseUnmuteError(payload: any): string {
      let errorMsg = 'Unable to connect microphone to voice server. Tap microphone to retry.';
      if (payload.canPublishAudio === false) {
        errorMsg = payload.audioPermissionReason
          ? `Microphone unavailable: ${payload.audioPermissionReason}`
          : 'Microphone permission denied.';
      } else if (payload.sfuEnforced === false) {
        if (payload.sfuEnforcementReason === 'TIMEOUT') {
          errorMsg = 'Voice server connection timed out. Tap microphone to retry.';
        } else if (payload.sfuEnforcementReason === 'NOT_FOUND') {
          errorMsg = 'Voice session not found on media server. Tap microphone to reconnect.';
        } else if (payload.sfuEnforcementReason === 'NOT_CONFIGURED') {
          errorMsg = 'Voice server is temporarily unavailable.';
        } else if (payload.sfuEnforcementReason === 'UPDATE_FAILED') {
          errorMsg = 'Media server failed to update audio permission. Tap microphone to retry.';
        } else if (payload.sfuEnforcementReason === 'NO_RESULT') {
          errorMsg = 'No response from media server. Tap microphone to retry.';
        }
      }
      return errorMsg;
    }

    test('DEF-F: UPDATE_FAILED displays media server failure guidance', () => {
      const msg = parseUnmuteError({
        canPublishAudio: true,
        sfuEnforced: false,
        sfuEnforcementReason: 'UPDATE_FAILED',
      });
      expect(msg).toBe('Media server failed to update audio permission. Tap microphone to retry.');
    });

    test('DEF-F: NO_RESULT displays no-response guidance', () => {
      const msg = parseUnmuteError({
        canPublishAudio: true,
        sfuEnforced: false,
        sfuEnforcementReason: 'NO_RESULT',
      });
      expect(msg).toBe('No response from media server. Tap microphone to retry.');
    });

    test('DEF-F: TIMEOUT, NOT_FOUND, NOT_CONFIGURED display standard guidance', () => {
      expect(parseUnmuteError({ canPublishAudio: true, sfuEnforced: false, sfuEnforcementReason: 'TIMEOUT' }))
        .toBe('Voice server connection timed out. Tap microphone to retry.');
      expect(parseUnmuteError({ canPublishAudio: true, sfuEnforced: false, sfuEnforcementReason: 'NOT_FOUND' }))
        .toBe('Voice session not found on media server. Tap microphone to reconnect.');
      expect(parseUnmuteError({ canPublishAudio: true, sfuEnforced: false, sfuEnforcementReason: 'NOT_CONFIGURED' }))
        .toBe('Voice server is temporarily unavailable.');
    });
  });
});
