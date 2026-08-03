/**
 * HALQA Load Test — API Baseline
 *
 * Scenario: 50 VUs hammering the most common read endpoints.
 * Used to baseline API performance before deploying changes.
 *
 * Run:
 *   k6 run scripts/load-test/api-baseline.js
 */

import http from 'k6/http'
import { sleep, check, group } from 'k6'
import { Rate } from 'k6/metrics'

const BASE_URL = __ENV.BASE_URL || 'http://localhost:5000/api/v1'
const errorRate = new Rate('errors')

export const options = {
  stages: [
    { duration: '30s', target: 10  },   // ramp up
    { duration: '60s', target: 50  },   // steady load
    { duration: '30s', target: 0   },   // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000', 'p(99)<2000'],
    errors:            ['rate<0.05'],
  },
}

export function setup() {
  const loginRes = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ email: 'teacher@halqa-academy.com', password: 'Teacher@2024' }),
    { headers: { 'Content-Type': 'application/json' } }
  )
  return { token: loginRes.json('data.accessToken') }
}

export default function (data) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${data.token}`,
  }

  group('Dashboard', () => {
    const res = http.get(`${BASE_URL}/dashboard`, { headers })
    errorRate.add(res.status !== 200)
    check(res, { 'dashboard 200': r => r.status === 200 })
  })

  group('Voice rooms list', () => {
    const res = http.get(`${BASE_URL}/voice?limit=20`, { headers })
    errorRate.add(res.status !== 200)
    check(res, { 'rooms list 200': r => r.status === 200 })
  })

  group('Feed', () => {
    const res = http.get(`${BASE_URL}/posts/feed?limit=20`, { headers })
    errorRate.add(res.status !== 200)
    check(res, { 'feed 200': r => r.status === 200 })
  })

  group('Leaderboard', () => {
    const res = http.get(`${BASE_URL}/gifts/leaderboard/daily`, { headers })
    errorRate.add(res.status !== 200)
    check(res, { 'leaderboard 200': r => r.status === 200 })
  })

  sleep(1)
}
