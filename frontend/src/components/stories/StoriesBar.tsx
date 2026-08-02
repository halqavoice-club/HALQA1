'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { storiesApi, type StoryGroup } from '@/lib/stories'
import { getAvatarUrl } from '@/lib/avatar'
import { useAuthStore } from '@/store/auth.store'
import { cn } from '@/lib/utils'
import { Plus } from 'lucide-react'
import { StoryViewer }   from './StoryViewer'
import { StoryComposer } from './StoryComposer'

export function StoriesBar() {
  const { user } = useAuthStore()
  const [viewerGroup,   setViewerGroup]   = useState<number | null>(null)
  const [showComposer,  setShowComposer]  = useState(false)

  const { data: groups = [], isLoading } = useQuery<StoryGroup[]>({
    queryKey: ['stories-feed'],
    queryFn:  () => storiesApi.getFeed().then(r => r.data.data),
    staleTime: 30_000,
    refetchInterval: 60_000,
  })

  const myGroup = groups.find(g => g.author.id === user?.id)
  const hasMyStory = (myGroup?.stories.length ?? 0) > 0

  if (isLoading && groups.length === 0) {
    return (
      <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-hide">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="flex-shrink-0 flex flex-col items-center gap-1.5">
            <div className="w-14 h-14 rounded-full bg-gray-200 animate-pulse" />
            <div className="w-10 h-2 bg-gray-200 rounded animate-pulse" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <>
      <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-hide">
        {/* Add Story button */}
        <div className="flex-shrink-0 flex flex-col items-center gap-1.5 cursor-pointer"
          onClick={() => setShowComposer(true)}>
          <div className="relative w-14 h-14">
            {/* Own avatar or placeholder */}
            <div className={cn(
              'w-14 h-14 rounded-full overflow-hidden border-2 flex items-center justify-center bg-gray-100',
              hasMyStory ? 'border-indigo-500' : 'border-gray-200'
            )}>
              {getAvatarUrl(user?.avatarUrl)
                ? <img src={getAvatarUrl(user?.avatarUrl)!} alt="" className="w-full h-full object-cover" />
                : <span className="text-lg font-bold text-gray-400">
                    {user?.firstName?.[0]}{user?.lastName?.[0]}
                  </span>
              }
            </div>
            {/* Plus badge */}
            <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 bg-indigo-600 border-2 border-white rounded-full flex items-center justify-center">
              <Plus className="w-3 h-3 text-white" />
            </div>
          </div>
          <span className="text-[10px] text-gray-500 font-medium">Your story</span>
        </div>

        {/* Other people's story groups */}
        {groups
          .filter(g => g.author.id !== user?.id)
          .map((group, idx) => {
            const realIdx = groups.findIndex(g => g.author.id === group.author.id)
            const avatarSrc = getAvatarUrl(group.author.avatarUrl)
            const initials  = `${group.author.firstName?.charAt(0) ?? ''}${group.author.lastName?.charAt(0) ?? ''}`.toUpperCase() || '?'
            const hasUnseen = group.hasUnseen

            return (
              <div key={group.author.id}
                className="flex-shrink-0 flex flex-col items-center gap-1.5 cursor-pointer"
                onClick={() => setViewerGroup(realIdx)}>
                <div className={cn(
                  'w-14 h-14 rounded-full p-0.5',
                  hasUnseen
                    ? 'bg-gradient-to-tr from-indigo-500 via-purple-500 to-pink-500'
                    : 'bg-gray-200'
                )}>
                  <div className="w-full h-full rounded-full overflow-hidden border-2 border-white bg-indigo-100 flex items-center justify-center text-sm font-bold text-indigo-600">
                    {avatarSrc
                      ? <img src={avatarSrc} alt="" className="w-full h-full object-cover" />
                      : initials
                    }
                  </div>
                </div>
                <span className="text-[10px] text-gray-500 font-medium max-w-[56px] truncate text-center">
                  {group.author.firstName}
                </span>
              </div>
            )
          })
        }
      </div>

      {/* Story Viewer */}
      {viewerGroup !== null && (
        <StoryViewer
          groups={groups}
          initialGroup={viewerGroup}
          onClose={() => setViewerGroup(null)}
        />
      )}

      {/* Story Composer */}
      {showComposer && (
        <StoryComposer onClose={() => setShowComposer(false)} />
      )}
    </>
  )
}
