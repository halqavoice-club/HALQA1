'use client'

import { useParams } from 'next/navigation'
// FE-002: Use the error-boundary-wrapped version so a LiveKit/SDK crash
// shows a recovery UI instead of crashing the entire page.
import { LiveClassRoomWithBoundary } from '@/components/live-class/LiveClassRoomWithBoundary'

export default function Page() {
  const { id } = useParams<{ id: string }>()
  return <LiveClassRoomWithBoundary id={id} />
}
