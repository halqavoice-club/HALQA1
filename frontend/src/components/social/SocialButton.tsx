'use client'
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { socialApi } from '@/lib/social'
import { useToast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'
import { Loader2 } from 'lucide-react'

interface Props {
  userId: string
  isFollowing: boolean
  friendStatus: 'none' | 'pending_sent' | 'pending_received' | 'friends'
  onUpdate?: () => void
  size?: 'sm' | 'md'
}

export function SocialButton({ userId, isFollowing, friendStatus, onUpdate, size = 'md' }: Props) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [loadingFollow, setLoadingFollow] = useState(false)
  const [loadingFriend, setLoadingFriend] = useState(false)

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['social-counts', userId] })
    queryClient.invalidateQueries({ queryKey: ['social-search'] })
    onUpdate?.()
  }

  const handleFollow = async () => {
    setLoadingFollow(true)
    try {
      if (isFollowing) {
        await socialApi.unfollow(userId)
        toast({ title: 'Unfollowed' })
      } else {
        await socialApi.follow(userId)
        toast({ title: '✅ Following!' })
      }
      invalidate()
    } catch (e: any) {
      toast({ title: e?.response?.data?.message || 'Failed', variant: 'destructive' })
    } finally { setLoadingFollow(false) }
  }

  const handleFriend = async () => {
    setLoadingFriend(true)
    try {
      if (friendStatus === 'none') {
        await socialApi.sendRequest(userId)
        toast({ title: '🤝 Friend request sent!' })
      } else if (friendStatus === 'pending_received') {
        await socialApi.acceptRequest(userId)
        toast({ title: '✅ Now friends!' })
      } else if (friendStatus === 'friends') {
        await socialApi.removeFriend(userId)
        toast({ title: 'Friend removed' })
      }
      invalidate()
    } catch (e: any) {
      toast({ title: e?.response?.data?.message || 'Failed', variant: 'destructive' })
    } finally { setLoadingFriend(false) }
  }

  const btnBase = size === 'sm'
    ? 'flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all'
    : 'flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-all'

  const followLabel = isFollowing ? 'Following' : 'Follow'
  const followCls = isFollowing
    ? 'bg-gray-100 text-gray-700 hover:bg-red-50 hover:text-red-600'
    : 'bg-indigo-600 text-white hover:bg-indigo-700'

  const friendLabel =
    friendStatus === 'friends'          ? 'Friends' :
    friendStatus === 'pending_sent'     ? 'Requested' :
    friendStatus === 'pending_received' ? 'Accept' : 'Add Friend'
  const friendCls =
    friendStatus === 'friends'          ? 'bg-green-100 text-green-700 hover:bg-red-50 hover:text-red-600' :
    friendStatus === 'pending_sent'     ? 'bg-gray-100 text-gray-500 cursor-default' :
    friendStatus === 'pending_received' ? 'bg-green-600 text-white hover:bg-green-700' :
                                          'bg-white border border-gray-300 text-gray-700 hover:border-indigo-400 hover:text-indigo-600'

  return (
    <div className="flex items-center gap-2">
      <button className={cn(btnBase, followCls)} onClick={handleFollow} disabled={loadingFollow}>
        {loadingFollow ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
        {followLabel}
      </button>
      <button
        className={cn(btnBase, friendCls)}
        onClick={friendStatus === 'pending_sent' ? undefined : handleFriend}
        disabled={loadingFriend || friendStatus === 'pending_sent'}
      >
        {loadingFriend ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
        {friendLabel}
      </button>
    </div>
  )
}
