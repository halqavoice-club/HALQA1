/**
 * Tests for FIX-3: mobile initSocket() active-guard (DISC-003).
 */

// ── socket.io-client mock ─────────────────────────────────────────────────────
const mockSocket = {
  connected: false,
  active: false,
  id: 'mobile-socket-id',
  auth: {} as Record<string, unknown>,
  on: jest.fn(),
  off: jest.fn(),
  emit: jest.fn(),
  connect: jest.fn(),
  disconnect: jest.fn(),
  removeAllListeners: jest.fn(),
}

const mockIo = jest.fn(() => mockSocket)
jest.mock('socket.io-client', () => ({ io: mockIo }))

// ── @/lib/api mock ────────────────────────────────────────────────────────────
jest.mock('@/lib/api', () => ({
  getSocketURL: () => 'http://localhost:5000',
}))

// ── Helpers ───────────────────────────────────────────────────────────────────
function resetMocks() {
  jest.resetModules()
  mockIo.mockClear()
  mockSocket.connected = false
  mockSocket.active = false
  mockSocket.on.mockClear()
  mockSocket.disconnect.mockClear()
  mockSocket.connect.mockClear()
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('FIX-3: initSocket() socket.active guard', () => {
  test('returns existing socket when socket.connected=true', () => {
    resetMocks()
    const { initSocket } = require('@/lib/socket')
    initSocket('token-1')       // first call — creates socket
    mockSocket.connected = true
    mockSocket.active = true
    initSocket('token-2')       // second call — should return existing socket
    expect(mockIo).toHaveBeenCalledTimes(1)
  })

  test('returns existing socket when socket.active=true (mid-reconnect, not yet connected)', () => {
    resetMocks()
    const { initSocket } = require('@/lib/socket')
    initSocket('token-1')       // first call — creates socket
    mockSocket.connected = false
    mockSocket.active = true    // socket is reconnecting
    initSocket('token-2')       // second call — must NOT create a second io() instance
    expect(mockIo).toHaveBeenCalledTimes(1)
  })

  test('creates new socket when previous socket is fully stopped (active=false, connected=false)', () => {
    resetMocks()
    const { initSocket } = require('@/lib/socket')
    initSocket('token-1')       // first call
    mockSocket.connected = false
    mockSocket.active = false   // socket fully stopped
    initSocket('token-2')       // second call — should create new socket
    expect(mockIo).toHaveBeenCalledTimes(2)
  })

  test('initSocket returns a Socket instance on first call', () => {
    resetMocks()
    const { initSocket } = require('@/lib/socket')
    const result = initSocket('token-1')
    expect(result).toBe(mockSocket)
  })
})
