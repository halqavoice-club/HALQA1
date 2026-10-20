/**
 * Mobile Background Sync — Backoff Unit Tests
 *
 * Validates that the exponential backoff algorithm:
 *   - starts at 30s
 *   - doubles on each failure up to 1800s
 *   - resets to 30s on success
 */

jest.mock('expo-secure-store', () => {
  const store: Record<string, string> = {}
  return {
    getItemAsync:    jest.fn(async (k: string) => store[k] ?? null),
    setItemAsync:    jest.fn(async (k: string, v: string) => { store[k] = v }),
    deleteItemAsync: jest.fn(async (k: string) => { delete store[k] }),
  }
})

import {
  getSyncBackoffSeconds,
  onSyncSuccess,
  onSyncFailed
} from '../lib/backgroundSync'

const SecureStore = require('expo-secure-store')

beforeEach(async () => {
  jest.clearAllMocks()
  // Reset stored backoff value
  SecureStore.deleteItemAsync.mockImplementation(async () => {})
  SecureStore.getItemAsync.mockResolvedValue(null)
  SecureStore.setItemAsync.mockImplementation(async () => {})
})

describe('getSyncBackoffSeconds()', () => {
  it('returns 30 when no stored value', async () => {
    SecureStore.getItemAsync.mockResolvedValue(null)
    const result = await getSyncBackoffSeconds()
    expect(result).toBe(30)
  })

  it('returns stored value', async () => {
    SecureStore.getItemAsync.mockResolvedValue('120')
    const result = await getSyncBackoffSeconds()
    expect(result).toBe(120)
  })
})

describe('onSyncFailed()', () => {
  it('doubles the backoff from initial value', async () => {
    SecureStore.getItemAsync.mockResolvedValue('30')
    await onSyncFailed()
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      expect.any(String),
      '60'
    )
  })

  it('caps at 1800 seconds', async () => {
    SecureStore.getItemAsync.mockResolvedValue('1800')
    await onSyncFailed()
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      expect.any(String),
      '1800'
    )
  })

  it('doubles sequentially: 30 → 60 → 120 → 240', async () => {
    let stored = '30'
    SecureStore.getItemAsync.mockImplementation(async () => stored)
    SecureStore.setItemAsync.mockImplementation(async (_k: string, v: string) => { stored = v })

    await onSyncFailed(); expect(stored).toBe('60')
    await onSyncFailed(); expect(stored).toBe('120')
    await onSyncFailed(); expect(stored).toBe('240')
  })
})

describe('onSyncSuccess()', () => {
  it('resets backoff to 30', async () => {
    SecureStore.getItemAsync.mockResolvedValue('600')
    await onSyncSuccess()
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      expect.any(String),
      '30'
    )
  })
})

