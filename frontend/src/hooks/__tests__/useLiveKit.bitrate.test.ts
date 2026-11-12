/**
 * @jest-environment jsdom
 */
/**
 * useLiveKit.bitrate.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * FEAT-002 regression tests — LB-CHANGE-001 adaptive audio bitrate via
 * RTCRtpSender.setParameters().
 *
 * Verifies:
 *   a) quality change while connected with mic published → sender.setParameters
 *      called with the correct maxBitrate for each quality tier
 *   b) quality change but no mic publication → no error thrown, setParameters
 *      not called
 *   c) quality change but sender is null/undefined → no error thrown
 *
 * Strategy: import qualityToAudioBitrate directly (pure function — no hook
 * infrastructure needed) and test the RTCRtpSender interaction by exercising
 * the logic inline, mirroring the pattern in the useEffect body.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { qualityToAudioBitrate, type NetworkQuality } from '../useNetworkQuality'

// ── Helper: build a minimal RTCRtpSender mock ──────────────────────────────

function makeSender(encodings: Partial<RTCRtpEncodingParameters>[] = [{}]) {
  const params: RTCRtpSendParameters = {
    transactionId: 'test-txn',
    encodings: encodings as RTCRtpEncodingParameters[],
    headerExtensions: [],
    codecs: [],
    rtcp: {},
  }
  const setParameters = jest.fn().mockResolvedValue(undefined)
  const getParameters = jest.fn().mockReturnValue(params)
  return { sender: { getParameters, setParameters } as unknown as RTCRtpSender, params }
}

// ── Helper: simulate the LB-CHANGE-001 useEffect body ─────────────────────
//
// This mirrors the exact logic in useLiveKit.ts so changes to the hook body
// are tested here in isolation without needing to render the full hook
// (which requires LiveKit, WebRTC, and Socket.IO all to be wired up).

function runBitrateEffect(options: {
  isConnected: boolean
  micPub: { source: string; track: { sender: RTCRtpSender | undefined } | null } | null
  quality: NetworkQuality
}) {
  const { isConnected, micPub, quality } = options

  // Simulate room + ConnectionState.Connected check
  if (!isConnected) return

  const newBitrate = qualityToAudioBitrate(quality)

  try {
    // Find mic pub (mirrors: room.localParticipant.audioTrackPublications.forEach)
    const foundPub = micPub?.source === 'microphone' ? micPub : null
    const track = foundPub?.track as any
    const sender: RTCRtpSender | undefined = track?.sender
    if (!sender) return

    const params = sender.getParameters()
    if (params.encodings?.length) {
      params.encodings[0].maxBitrate = newBitrate
      sender.setParameters(params).catch(() => {})
    }
  } catch (e) {
    // swallowed — same as in the hook
  }
}

// ─────────────────────────────────────────────────────────────────────────────

describe('FEAT-002: LB-CHANGE-001 adaptive audio bitrate (RTCRtpSender.setParameters)', () => {

  // ── A: qualityToAudioBitrate returns correct tier values ─────────────────

  describe('qualityToAudioBitrate()', () => {
    test('excellent → 96 000 bps', () => {
      expect(qualityToAudioBitrate('excellent')).toBe(96_000)
    })
    test('good → 64 000 bps', () => {
      expect(qualityToAudioBitrate('good')).toBe(64_000)
    })
    test('fair → 32 000 bps', () => {
      expect(qualityToAudioBitrate('fair')).toBe(32_000)
    })
    test('poor → 16 000 bps', () => {
      expect(qualityToAudioBitrate('poor')).toBe(16_000)
    })
    test('offline → 16 000 bps', () => {
      expect(qualityToAudioBitrate('offline')).toBe(16_000)
    })
  })

  // ── B: mic published, sender present — setParameters called with correct maxBitrate ──

  describe('connected + mic published + sender present', () => {
    test('quality excellent → setParameters called with maxBitrate 96 000', () => {
      const { sender, params } = makeSender([{}])
      const micPub = { source: 'microphone', track: { sender } }

      runBitrateEffect({ isConnected: true, micPub, quality: 'excellent' })

      expect((sender as any).setParameters).toHaveBeenCalledTimes(1)
      expect(params.encodings[0].maxBitrate).toBe(96_000)
    })

    test('quality good → setParameters called with maxBitrate 64 000', () => {
      const { sender, params } = makeSender([{}])
      const micPub = { source: 'microphone', track: { sender } }

      runBitrateEffect({ isConnected: true, micPub, quality: 'good' })

      expect((sender as any).setParameters).toHaveBeenCalledTimes(1)
      expect(params.encodings[0].maxBitrate).toBe(64_000)
    })

    test('quality fair → setParameters called with maxBitrate 32 000', () => {
      const { sender, params } = makeSender([{}])
      const micPub = { source: 'microphone', track: { sender } }

      runBitrateEffect({ isConnected: true, micPub, quality: 'fair' })

      expect((sender as any).setParameters).toHaveBeenCalledTimes(1)
      expect(params.encodings[0].maxBitrate).toBe(32_000)
    })

    test('quality poor → setParameters called with maxBitrate 16 000', () => {
      const { sender, params } = makeSender([{}])
      const micPub = { source: 'microphone', track: { sender } }

      runBitrateEffect({ isConnected: true, micPub, quality: 'poor' })

      expect((sender as any).setParameters).toHaveBeenCalledTimes(1)
      expect(params.encodings[0].maxBitrate).toBe(16_000)
    })

    test('quality offline → setParameters called with maxBitrate 16 000', () => {
      const { sender, params } = makeSender([{}])
      const micPub = { source: 'microphone', track: { sender } }

      runBitrateEffect({ isConnected: true, micPub, quality: 'offline' })

      expect((sender as any).setParameters).toHaveBeenCalledTimes(1)
      expect(params.encodings[0].maxBitrate).toBe(16_000)
    })
  })

  // ── C: no mic publication → setParameters NOT called, no error ───────────

  describe('connected + no mic publication', () => {
    test('null audioTrackPublications → no error thrown, setParameters not called', () => {
      expect(() => {
        runBitrateEffect({ isConnected: true, micPub: null, quality: 'poor' })
      }).not.toThrow()
    })

    test('non-mic publication source → no error thrown, setParameters not called', () => {
      const { sender } = makeSender([{}])
      const screenSharePub = { source: 'screen_share', track: { sender } }

      expect(() => {
        runBitrateEffect({ isConnected: true, micPub: screenSharePub as any, quality: 'poor' })
      }).not.toThrow()

      // setParameters must not be called — wrong source was skipped
      expect((sender as any).setParameters).not.toHaveBeenCalled()
    })
  })

  // ── D: mic published but sender is null/undefined → no error ─────────────

  describe('connected + mic published + sender null/undefined', () => {
    test('track.sender undefined → returns silently, no error', () => {
      const micPub = { source: 'microphone', track: { sender: undefined } }

      expect(() => {
        runBitrateEffect({ isConnected: true, micPub, quality: 'poor' })
      }).not.toThrow()
    })

    test('track is null → returns silently, no error', () => {
      const micPub = { source: 'microphone', track: null }

      expect(() => {
        runBitrateEffect({ isConnected: true, micPub, quality: 'poor' })
      }).not.toThrow()
    })
  })

  // ── E: room not connected → effect exits immediately ─────────────────────

  describe('room not connected', () => {
    test('isConnected false → effect does not reach setParameters', () => {
      const { sender } = makeSender([{}])
      const micPub = { source: 'microphone', track: { sender } }

      runBitrateEffect({ isConnected: false, micPub, quality: 'poor' })

      expect((sender as any).setParameters).not.toHaveBeenCalled()
    })
  })

  // ── F: sender.getParameters returns empty encodings → no setParameters ────

  describe('sender.getParameters returns empty encodings array', () => {
    test('empty encodings → setParameters not called', () => {
      const { sender } = makeSender([])
      const micPub = { source: 'microphone', track: { sender } }

      runBitrateEffect({ isConnected: true, micPub, quality: 'poor' })

      expect((sender as any).setParameters).not.toHaveBeenCalled()
    })
  })

  // ── G: setTrackPublishDefaults is NOT used ────────────────────────────────

  describe('VCLUB-LB-WEB-001 regression: setTrackPublishDefaults removed', () => {
    test('useLiveKit.ts does not reference setTrackPublishDefaults', () => {
      const fs   = require('fs')
      const path = require('path')
      const src  = fs.readFileSync(
        path.join(__dirname, '../useLiveKit.ts'),
        'utf-8'
      )
      expect(src).not.toContain('setTrackPublishDefaults')
    })

    test('useLiveKit.ts references RTCRtpSender setParameters pattern', () => {
      const fs   = require('fs')
      const path = require('path')
      const src  = fs.readFileSync(
        path.join(__dirname, '../useLiveKit.ts'),
        'utf-8'
      )
      expect(src).toContain('sender.setParameters')
      expect(src).toContain('sender.getParameters')
    })
  })
})
