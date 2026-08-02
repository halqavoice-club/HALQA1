/**
 * DO-007: Frontend health check endpoint
 * ─────────────────────────────────────────────────────────────────────────────
 * Used by Docker healthcheck and nginx upstream monitoring.
 * Returns 200 if the Next.js process is alive and able to serve requests.
 *
 * Called by: docker-compose.prod.yml healthcheck
 *   test: ["CMD", "wget", "-qO-", "http://localhost:3000/api/health"]
 *
 * Does NOT check backend connectivity — that's the backend's /health endpoint.
 * This only confirms the Next.js process itself is running.
 */
import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json(
    {
      status: 'ok',
      service: 'halqa-frontend',
      timestamp: new Date().toISOString(),
    },
    { status: 200 }
  )
}

// Force dynamic — disable static caching for the health route
export const dynamic = 'force-dynamic'
