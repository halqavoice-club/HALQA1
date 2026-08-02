'use client'
import { useEffect, useRef } from 'react'
import { getSocket } from '@/lib/socket'
import { useSocialStore } from '@/store/social.store'
import { useToast } from '@/components/ui/use-toast'
import { useQueryClient } from '@tanstack/react-query'
import { socialApi } from '@/lib/social'
import { useAuthStore } from '@/store/auth.store'

/** Registers global socket listeners for social events. Mount once in layout. */
export function useSocialSocket() {
  const { toast } = useToast()
  const { incrementPending, decrementPending, setPendingCount } = useSocialStore()
  const { isAuthenticated, user } = useAuthStore()
  const queryClient = useQueryClient()

  // Guard against Strict Mode double-invoke
  const fetchedRef = useRef(false)

  // Load initial pending friend-request count — once per authenticated session
  useEffect(() => {
    if (!isAuthenticated || !user?.id || fetchedRef.current) return
    fetchedRef.current = true
    socialApi.incomingRequests()
      .then(r => setPendingCount((r.data.data as any[]).length))
      .catch(() => {}) // non-fatal
    return () => {
      fetchedRef.current = false
    }
  }, [isAuthenticated, user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Socket event listeners
  useEffect(() => {
    const socket = getSocket()
    if (!socket || !isAuthenticated) return

    const onFollowed = (data: any) => {
      toast({ title: `👤 ${data.follower?.firstName} started following you` })
      queryClient.invalidateQueries({ queryKey: ['social-counts'] })
    }

    const onFriendRequest = (data: any) => {
      toast({ title: `🤝 ${data.sender?.firstName} sent you a friend request` })
      incrementPending()
      queryClient.invalidateQueries({ queryKey: ['friend-requests-incoming'] })
    }

    const onRequestAccepted = (data: any) => {
      toast({ title: `✅ ${data.friend?.firstName} accepted your friend request!` })
      queryClient.invalidateQueries({ queryKey: ['friends'] })
      queryClient.invalidateQueries({ queryKey: ['social-counts'] })
    }

    const onRequestRejected = () => {
      queryClient.invalidateQueries({ queryKey: ['friend-requests-sent'] })
    }

    const onFriendRemoved = () => {
      queryClient.invalidateQueries({ queryKey: ['friends'] })
      queryClient.invalidateQueries({ queryKey: ['social-counts'] })
    }

    socket.on('social:followed',         onFollowed)
    socket.on('social:friend_request',   onFriendRequest)
    socket.on('social:request_accepted', onRequestAccepted)
    socket.on('social:request_rejected', onRequestRejected)
    socket.on('social:friend_removed',   onFriendRemoved)

    return () => {
      socket.off('social:followed',         onFollowed)
      socket.off('social:friend_request',   onFriendRequest)
      socket.off('social:request_accepted', onRequestAccepted)
      socket.off('social:request_rejected', onRequestRejected)
      socket.off('social:friend_removed',   onFriendRemoved)
    }
  }, [isAuthenticated, user?.id]) // eslint-disable-line react-hooks/exhaustive-deps
}
