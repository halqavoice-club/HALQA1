'use client'

/**
 * /live-stream/[id] — Public live stream room
 *
 * Public live streams are LiveClass records with streamType = 'PUBLIC'.
 * They share the exact same backend API, database table, and room UI as
 * school live classes — only the streamType field differs.
 *
 * This page is a thin wrapper that passes the id to the same
 * LiveClassRoomWithBoundary component used by /live-class/[id].
 * This means all existing room features (chat, gifts, whiteboard, polls,
 * hand raise, host controls) work identically for public streams.
 *
 * Any link pointing to /live-stream/:id (e.g. from the social feed
 * LIVE_CLASS_SHARE card) will land here and render correctly.
 */

import { useParams } from 'next/navigation'
import { LiveClassRoomWithBoundary } from '@/components/live-class/LiveClassRoomWithBoundary'

export default function LiveStreamPage() {
  const { id } = useParams<{ id: string }>()
  return <LiveClassRoomWithBoundary id={id} />
}
