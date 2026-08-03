/**
 * Mobile Offline Queue — Unit Tests
 *
 * Validates the offline mutation queue:
 *   - 500-action hard cap (Req 16.3)
 *   - fail-count retry limit of 3 (Req 16.4)
 *   - successful sync clears the queue
 *
 * Uses in-memory MMKV mock and axios mock — no real backend needed.
 */

// ─── Mock MMKV storage (getStoredJSON / setStoredJSON / deleteStoredItem) ─────
const _mmkv: Record<string, any> = {}
jest.mock('../lib/storage', () => ({
  getStoredJSON:  jest.fn((key: string) => _mmkv[key] ?? null),
  setStoredJSON:  jest.fn((key: string, value: any) => { _mmkv[key] = value }),
  deleteStoredItem: jest.fn((key: string) => { delete _mmkv[key] }),
}))

// ─── Mock NetInfo — always online unless overridden ───────────────────────────
jest.mock('@react-native-community/netinfo', () => ({
  fetch: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })),
}))

// ─── Mock flash-message ───────────────────────────────────────────────────────
jest.mock('react-native-flash-message', () => ({ showMessage: jest.fn() }))

// ─── Mock analytics ───────────────────────────────────────────────────────────
jest.mock('../lib/analytics', () => ({ logEvent: jest.fn(async () => {}) }))

// ─── Mock API module ──────────────────────────────────────────────────────────
const mockRequest = jest.fn()
jest.mock('../lib/api', () => ({
  __esModule: true,
  default: { request: (...args: any[]) => mockRequest(...args) },
  setAccessToken: jest.fn(),
}))

import { getStoredJSON, setStoredJSON, deleteStoredItem } from '../lib/storage'
import {
  queueOfflineAction,
  syncPendingActions,
  OfflineAction,
} from '../lib/offline'

const PENDING_KEY = 'halqa_pending_actions'

function getPending(): OfflineAction[] {
  return (getStoredJSON as jest.Mock).mock.results.length > 0
    ? (_mmkv[PENDING_KEY] ?? [])
    : []
}

beforeEach(() => {
  jest.clearAllMocks()
  // Reset the in-memory store
  delete _mmkv[PENDING_KEY]
  mockRequest.mockReset()
})

// ─── Queue cap ────────────────────────────────────────────────────────────────

describe('queueOfflineAction()', () => {
  it('queues an action', async () => {
    await queueOfflineAction({ method: 'POST', url: '/posts', body: { body: 'hello' } })
    const q: OfflineAction[] = _mmkv[PENDING_KEY] ?? []
    expect(q.length).toBe(1)
    expect(q[0].url).toBe('/posts')
  })

  it('does not exceed 500 actions (cap)', async () => {
    // Pre-fill to 500
    const items: OfflineAction[] = Array.from({ length: 500 }, (_, i) => ({
      id: `id-${i}`,
      createdAt: Date.now(),
      method: 'POST' as const,
      url: `/messages/${i}`,
      failCount: 0,
    }))
    _mmkv[PENDING_KEY] = items

    await queueOfflineAction({ method: 'POST', url: '/overflow', body: {} })

    const q: OfflineAction[] = _mmkv[PENDING_KEY] ?? []
    expect(q.length).toBe(500)
    expect(q.find(a => a.url === '/overflow')).toBeUndefined()
  })

  it('assigns failCount=0 on initial queue', async () => {
    await queueOfflineAction({ method: 'POST', url: '/likes', body: {} })
    const q: OfflineAction[] = _mmkv[PENDING_KEY] ?? []
    expect(q[0].failCount ?? 0).toBe(0)
  })
})

// ─── Sync ─────────────────────────────────────────────────────────────────────

describe('syncPendingActions()', () => {
  it('removes action on success', async () => {
    _mmkv[PENDING_KEY] = [{
      id: 'a1', createdAt: Date.now(), method: 'POST', url: '/posts', body: {}, failCount: 0
    }]
    mockRequest.mockResolvedValueOnce({ data: {} })

    const result = await syncPendingActions()
    expect(result).toBe(true)
    expect(_mmkv[PENDING_KEY]).toBeUndefined() // deleteStoredItem was called
  })

  it('increments failCount on failure and re-queues', async () => {
    _mmkv[PENDING_KEY] = [{
      id: 'a2', createdAt: Date.now(), method: 'POST', url: '/posts', body: {}, failCount: 0
    }]
    mockRequest.mockRejectedValueOnce(new Error('network'))

    await syncPendingActions()

    const q: OfflineAction[] = _mmkv[PENDING_KEY] ?? []
    expect(q.length).toBe(1)
    expect(q[0].failCount).toBe(1)
  })

  it('discards action after 3 failures (MAX_FAIL_COUNT)', async () => {
    _mmkv[PENDING_KEY] = [{
      id: 'a3', createdAt: Date.now(), method: 'POST', url: '/posts', body: {}, failCount: 2
    }]
    mockRequest.mockRejectedValueOnce(new Error('network'))

    await syncPendingActions()

    // Action should be discarded — queue empty
    const q: OfflineAction[] = _mmkv[PENDING_KEY] ?? []
    expect(q.length).toBe(0)
  })

  it('returns false when nothing pending', async () => {
    _mmkv[PENDING_KEY] = []
    const result = await syncPendingActions()
    expect(result).toBe(false)
  })

  it('processes all actions sequentially', async () => {
    _mmkv[PENDING_KEY] = [
      { id: 'b1', createdAt: Date.now(), method: 'POST', url: '/a', body: {}, failCount: 0 },
      { id: 'b2', createdAt: Date.now(), method: 'POST', url: '/b', body: {}, failCount: 0 },
    ]
    mockRequest.mockResolvedValue({ data: {} })

    const result = await syncPendingActions()
    expect(result).toBe(true)
    expect(mockRequest).toHaveBeenCalledTimes(2)
  })

  it('returns false when at least one action fails', async () => {
    _mmkv[PENDING_KEY] = [
      { id: 'c1', createdAt: Date.now(), method: 'POST', url: '/ok', body: {}, failCount: 0 },
      { id: 'c2', createdAt: Date.now(), method: 'POST', url: '/fail', body: {}, failCount: 0 },
    ]
    mockRequest.mockResolvedValueOnce({ data: {} })
    mockRequest.mockRejectedValueOnce(new Error('fail'))

    const result = await syncPendingActions()
    expect(result).toBe(false)
  })
})
