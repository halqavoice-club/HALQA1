'use client'

import { useParams, useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import api from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/use-toast'
import { useAuthStore } from '@/store/auth.store'
import { useSchoolAccess } from '@/hooks/useSchoolAccess'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { ArrowLeft, Pin, Calendar, Users, Trash2, Megaphone } from 'lucide-react'
import Link from 'next/link'
import { format } from 'date-fns'

export default function AnnouncementDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { user } = useAuthStore()
  const { activeRole } = useSchoolAccess()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const { data: announcements, isLoading } = useQuery({
    queryKey: ['announcements'],
    queryFn: () => api.get('/announcements').then(r => r.data.data)
  })

  const announcement = announcements?.find((a: any) => a.id === id)

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/announcements/${id}`),
    onSuccess: () => {
      toast({ title: 'Announcement deleted' })
      queryClient.invalidateQueries({ queryKey: ['announcements'] })
      router.push('/announcements')
    },
    onError: () => toast({ title: 'Delete failed', variant: 'destructive' })
  })

  // SA-ANN-03: SUPER_ADMIN is a platform role — not a school-scoped teacher/admin.
  // Deleting announcements is a school-scoped action.
  const canDelete = ['SCHOOL_ADMIN', 'TEACHER'].includes(user?.role || '') || ['SCHOOL_ADMIN','TEACHER'].includes(activeRole || '')

  if (isLoading) {
    return (
      <div className="max-w-2xl space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    )
  }

  if (!announcement) {
    return (
      <div className="text-center py-16">
        <Megaphone className="w-12 h-12 text-gray-300 mx-auto mb-3" />
        <p className="text-gray-500">Announcement not found</p>
        <Link href="/announcements">
          <Button variant="outline" className="mt-4">Back to Announcements</Button>
        </Link>
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <Link href="/announcements" className="flex items-center gap-2 text-gray-500 hover:text-gray-700 text-sm">
          <ArrowLeft className="w-4 h-4" /> Back to Announcements
        </Link>
        {canDelete && (
          <Button
            variant="outline" size="sm"
            className="gap-2 text-red-600 border-red-200 hover:bg-red-50"
            onClick={() => setShowDeleteConfirm(true)}
          >
            <Trash2 className="w-4 h-4" /> Delete
          </Button>
        )}
      </div>

      <Card className={`border-0 shadow-sm ${announcement.isPinned ? 'border-l-4 border-l-halqa-500' : ''}`}>
        <CardContent className="p-6">
          {/* Header */}
          <div className="flex items-start gap-3 mb-4">
            <div className="w-12 h-12 bg-halqa-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <Megaphone className="w-6 h-6 text-halqa-700" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                {announcement.isPinned && (
                  <Badge className="bg-halqa-100 text-halqa-700 gap-1 text-xs">
                    <Pin className="w-3 h-3" /> Pinned
                  </Badge>
                )}
                {announcement.targetRoles?.map((r: string) => (
                  <Badge key={r} variant="secondary" className="text-xs">{r}</Badge>
                ))}
              </div>
              <h1 className="text-xl font-bold text-gray-900 mt-1">{announcement.title}</h1>
            </div>
          </div>

          {/* Meta */}
          <div className="flex flex-wrap gap-4 text-xs text-gray-500 mb-5 pb-5 border-b border-gray-100">
            <span className="flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" />
              Published {format(new Date(announcement.publishAt || announcement.createdAt), 'MMMM d, yyyy h:mm a')}
            </span>
            {announcement.expiresAt && (
              <span className="flex items-center gap-1 text-orange-500">
                <Calendar className="w-3.5 h-3.5" />
                Expires {format(new Date(announcement.expiresAt), 'MMMM d, yyyy')}
              </span>
            )}
            {announcement.targetRoles?.length > 0 && (
              <span className="flex items-center gap-1">
                <Users className="w-3.5 h-3.5" />
                For: {announcement.targetRoles.join(', ')}
              </span>
            )}
          </div>

          {/* Content */}
          <div className="prose prose-sm max-w-none">
            <p className="text-gray-700 leading-relaxed whitespace-pre-wrap text-base">
              {announcement.content}
            </p>
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={showDeleteConfirm}
        title="Delete Announcement"
        message="Are you sure you want to delete this announcement? This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  )
}
