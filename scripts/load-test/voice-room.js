/**
 * HALQA Load Test — Voice Room Join/Leave
 *
 * Scenario: 100 virtual users each join a voice room, stay 30s, leave.
 * Pass thresholds: p95 latency < 500ms, error rate < 1%
 *
 * Run:
 *   k6 run scripts/load-test/voice-room.js
 *   k6 run --vus 50 --duration 60s scripts/load-test/voice-room.js
 *
 * Install k6: https://k6.io/docs/get-started/installation/
 */

import http from 'k6/http'
import { sleep, check } from 'k6'

// ─── Config ───────────────────────────────────────────────────────────────────
const BASE_URL   = __ENV.BASE_URL   || 'http://localhost:5000/api/v1'
const TEST_EMAIL = __ENV.TEST_EMAIL || 'student1@halqa.com'
const TEST_PASS  = __ENV.TEST_PASS  || 'Student@2024'
const ROOM_ID    = __ENV.ROOM_ID    || null  // set to a known room ID, or leave null to create one

export const options = {
  vus: 100,
  duration: '60s',
  thresholds: {
    http_req_duration: ['p(95)<500'],  // 95% of requests < 500ms
    http_req_failed:   ['rate<0.01'],  // error rate < 1%
  },
}

// ─── Setup: login once per VU ──────────────────────────────────────────────────
export function setup() {
  const loginRes = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ email: TEST_EMAIL, password: TEST_PASS }),
    { headers: { 'Content-Type': 'application/json' } }
  )
  check(loginRes, { 'login ok': r => r.status === 200 })

  const token = loginRes.json('data.accessToken')
  const roomId = ROOM_ID || createTestRoom(token)
  return { token, roomId }
}

function createTestRoom(token) {
  const res = http.post(
    `${BASE_URL}/voice`,
    JSON.stringify({ title: 'Load Test Room', privacy: 'PUBLIC' }),
    { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } }
  )
  check(res, { 'room created': r => r.status === 201 })
  return res.json('data.id')
}

// ─── Main scenario ────────────────────────────────────────────────────────────
export default function (data) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${data.token}`,
  }

  // Join room
  const joinRes = http.post(`${BASE_URL}/voice/${data.roomId}/join`, '{}', { headers })
  check(joinRes, {
    'join status 200': r => r.status === 200,
    'join has participants': r => r.json('data.participants') !== undefined,
  })

  sleep(Math.random() * 10 + 5)  // stay 5–15 seconds

  // Leave room
  const leaveRes = http.post(`${BASE_URL}/voice/${data.roomId}/leave`, '{}', { headers })
  check(leaveRes, { 'leave status 200': r => r.status === 200 })

  sleep(1)
}
