/**
 * Tests for FIX-2: frontend socket reconnect guards.
 * DISC-002: reconnectionAttempts cap + connect_error token-refresh guard +
 *           updateSocketToken active-socket fix.
 */

// ── socket.io-client mock ─────────────────────────────────────────────────────
const mockSocket = {
  connected: false,
  active: false,
  id: 'test-socket-id',
  auth: {} as Record<string, unknown>,
  on: jest.fn(),
  off: jest.fn(),
  emit: jest.fn(),
  connect: jest.fn(),
  disconnect: jest.fn(),
  removeAllListeners: jest.fn(),
  io: { engine: { transport: { name: 'polling' } } },
}

const mockIo = jest.fn(() => mockSocket)
jest.mock('socket.io-client', () => ({ io: mockIo }))

// ── auth store mock ───────────────────────────────────────────────────────────
const mockRefreshToken = jest.fn().mockResolvedValue(undefined)
jest.mock('@/store/auth.store', () => ({
  useAuthStore: {
    getState: () => ({ refreshToken: mockRefreshToken }),
  },
}))

// ── Helpers ───────────────────────────────────────────────────────────────────
function resetMocks() {
  jest.resetModules()
  mockIo.mockClear()
  mockRefreshToken.mockClear()
  mockSocket.connected = false
  mockSocket.active = false
  mockSocket.auth = {}
  mockSocket.on.mockClear()
  mockSocket.off.mockClear()
  mockSocket.connect.mockClear()
  mockSocket.disconnect.mockClear()
  mockSocket.removeAllListeners.mockClear()
}

// Helper: get the registered handler for a given event from mock socket.on calls
function getHandler(eventName: string): ((...args: any[]) => void) | undefined {
  const call = (mockSocket.on as jest.Mock).mock.calls.find(
    ([evt]: [string]) => evt === eventName
  )
  return call?.[1]
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('FIX-2: reconnectionAttempts is 15', () => {
  test('io() is called with reconnectionAttempts: 15', () => {
    resetMocks()
    const { initSocket } = require('@/lib/socket')
    initSocket('test-token')
    expect(mockIo).toHaveBeenCalledTimes(1)
    const options = (mockIo as jest.Mock).mock.calls[0][1]
    expect(options.reconnectionAttempts).toBe(15)
  })
})

describe('FIX-2: connect_error handler triggers refreshToken on token errors', () => {
  test('connect_error with "Token expired" triggers refreshToken() once', async () => {
    resetMocks()
    const { initSocket } = require('@/lib/socket')
    initSocket('test-token')
    const handler = getHandler('connect_error')
    expect(handler).toBeDefined()
    handler!(new Error('Token expired'))
    // refreshToken is async — wait for microtask queue
    await Promise.resolve()
    expect(mockRefreshToken).toHaveBeenCalledTimes(1)
  })

  test('connect_error with "Invalid token" triggers refreshToken() once', async () => {
    resetMocks()
    const { initSocket } = require('@/lib/socket')
    initSocket('test-token')
    const handler = getHandler('connect_error')
    handler!(new Error('Invalid token'))
    await Promise.resolve()
    expect(mockRefreshToken).toHaveBeenCalledTimes(1)
  })

  test('rapid-fire connect_error calls refreshToken() only once (isRefreshingForSocket guard)', async () => {
    resetMocks()
    // Make refreshToken never resolve so guard stays true
    mockRefreshToken.mockImplementation(() => new Promise(() => {}))
    const { initSocket } = require('@/lib/socket')
    initSocket('test-token')
    const handler = getHandler('connect_error')
    handler!(new Error('Token expired'))
    handler!(new Error('Token expired'))
    handler!(new Error('Token expired'))
    handler!(new Error('Token expired'))
    handler!(new Error('Token expired'))
    await Promise.resolve()
    expect(mockRefreshToken).toHaveBeenCalledTimes(1)
  })

  test('non-token connect_error does NOT trigger refreshToken()', async () => {
    resetMocks()
    const { initSocket } = require('@/lib/socket')
    initSocket('test-token')
    const handler = getHandler('connect_error')
    handler!(new Error('xhr poll error'))
    await Promise.resolve()
    expect(mockRefreshToken).not.toHaveBeenCalled()
  })
})

describe('FIX-2: updateSocketToken handles active-but-not-connected socket', () => {
  test('when socket.active=true and connected=false: calls disconnect() then connect()', () => {
    resetMocks()
    const { initSocket, updateSocketToken } = require('@/lib/socket')
    initSocket('old-token')
    mockSocket.active = true
    mockSocket.connected = false
    updateSocketToken('new-token')
    expect(mockSocket.disconnect).toHaveBeenCalledTimes(1)
    expect(mockSocket.connect).toHaveBeenCalledTimes(1)
    expect(mockSocket.auth).toEqual({ token: 'new-token' })
  })

  test('when socket.connected=false and active=false: calls connect() only (no disconnect)', () => {
    resetMocks()
    const { initSocket, updateSocketToken } = require('@/lib/socket')
    initSocket('old-token')
    mockSocket.active = false
    mockSocket.connected = false
    updateSocketToken('new-token')
    expect(mockSocket.disconnect).not.toHaveBeenCalled()
    expect(mockSocket.connect).toHaveBeenCalledTimes(1)
  })

  test('when socket.connected=true: updates auth but does not disconnect or reconnect', () => {
    resetMocks()
    const { initSocket, updateSocketToken } = require('@/lib/socket')
    initSocket('old-token')
    mockSocket.connected = true
    mockSocket.active = true
    updateSocketToken('new-token')
    expect(mockSocket.disconnect).not.toHaveBeenCalled()
    expect(mockSocket.connect).not.toHaveBeenCalled()
    expect(mockSocket.auth).toEqual({ token: 'new-token' })
  })
})
