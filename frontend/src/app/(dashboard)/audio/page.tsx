'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/use-toast'
import { useAuthStore } from '@/store/auth.store'
import { useEducationRole } from '@/hooks/useEducationRole'
import {
  Headphones, Plus, Upload, Play, Pause, SkipBack, SkipForward,
  Volume2, Trash2, Edit, BookOpen, Loader2, X, Music,
  Clock, Search, Download
} from 'lucide-react'
import { format } from 'date-fns'

import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { ErrorState } from '@/components/ui/error-state'
import { resolveMediaUrl } from '@/lib/media'

// ─── Types ────────────────────────────────────────────────────────────────────
interface Category { id: string; name: string; slug: string; description?: string; isDefault: boolean; isCustom: boolean; _count?: { courses: number; lessons: number } }
interface Course { id: string; title: string; description?: string; category: Category; teacher: any; _count?: { lessons: number } }
interface Lesson { id: string; title: string; description?: string; audioUrl: string; duration?: number; fileSize: number; playCount: number; course: { id: string; title: string }; category: Category; teacher: any; createdAt: string }

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatDuration(seconds?: number) {
  if (!seconds) return '--:--'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ─── Category Colors ──────────────────────────────────────────────────────────
const CATEGORY_COLORS: Record<string, string> = {
  tafsiira: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  riyaada:  'bg-blue-100 text-blue-700 border-blue-200',
  tawhiid:  'bg-purple-100 text-purple-700 border-purple-200',
  usool:    'bg-orange-100 text-orange-700 border-orange-200',
  buluga:   'bg-rose-100 text-rose-700 border-rose-200',
  tajwiid:  'bg-teal-100 text-teal-700 border-teal-200',
  arbina:   'bg-amber-100 text-amber-700 border-amber-200',
}
function catColor(slug: string) { return CATEGORY_COLORS[slug] || 'bg-gray-100 text-gray-700 border-gray-200' }

// ─── Audio Player Component ───────────────────────────────────────────────────
function AudioPlayer({ lesson, onClose, playlist, onNext, onPrev }: {
  lesson: Lesson; onClose: () => void
  playlist?: Lesson[]; onNext?: () => void; onPrev?: () => void
}) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [speed, setSpeed] = useState(1)
  const [volume, setVolume] = useState(1)
  const apiBase = ''  // resolveMediaUrl handles the prefix

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.src = resolveMediaUrl(lesson.audioUrl)
    audio.load()
    audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
    return () => { audio.pause() }
  }, [lesson.audioUrl, apiBase])

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed
  }, [speed])

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume
  }, [volume])

  const togglePlay = () => {
    const audio = audioRef.current
    if (!audio) return
    if (playing) { audio.pause(); setPlaying(false) }
    else { audio.play(); setPlaying(true) }
  }

  const seek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = parseFloat(e.target.value)
    if (audioRef.current) audioRef.current.currentTime = t
    setCurrentTime(t)
  }

  const handleDownload = () => {
    const a = document.createElement('a')
    a.href = resolveMediaUrl(lesson.audioUrl)
    a.download = lesson.title + '.mp3'
    a.click()
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-halqa-900 text-white shadow-2xl border-t border-halqa-700">
      <audio
        ref={audioRef}
        onTimeUpdate={e => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={e => setDuration(e.currentTarget.duration)}
        onEnded={() => { setPlaying(false); onNext?.() }}
      />
      {/* Progress bar */}
      <div className="px-4 pt-2">
        <input
          type="range" min={0} max={duration || 100} step={0.1} value={currentTime}
          onChange={seek}
          className="w-full h-1 accent-halqa-400 cursor-pointer"
        />
        <div className="flex justify-between text-xs text-halqa-400 mt-0.5">
          <span>{formatDuration(currentTime)}</span>
          <span>{formatDuration(duration || lesson.duration)}</span>
        </div>
      </div>

      <div className="flex items-center gap-3 px-4 pb-3 pt-1">
        {/* Track info */}
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-10 h-10 bg-halqa-700 rounded-lg flex items-center justify-center flex-shrink-0">
            <Music className="w-5 h-5 text-halqa-300" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{lesson.title}</p>
            <p className="text-xs text-halqa-400 truncate">
              {lesson.teacher?.user?.firstName} {lesson.teacher?.user?.lastName} · {lesson.category?.name}
            </p>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
          <button onClick={onPrev} disabled={!onPrev} className="p-2 rounded-full hover:bg-halqa-700 disabled:opacity-30 transition-colors">
            <SkipBack className="w-4 h-4" />
          </button>
          <button onClick={togglePlay} className="w-10 h-10 bg-white text-halqa-900 rounded-full flex items-center justify-center hover:bg-halqa-100 transition-colors">
            {playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
          </button>
          <button onClick={onNext} disabled={!onNext} className="p-2 rounded-full hover:bg-halqa-700 disabled:opacity-30 transition-colors">
            <SkipForward className="w-4 h-4" />
          </button>
        </div>

        {/* Speed + Volume + Actions */}
        <div className="flex items-center gap-2 ml-2">
          <select
            value={speed}
            onChange={e => setSpeed(parseFloat(e.target.value))}
            className="bg-halqa-800 text-white text-xs rounded px-2 py-1 border border-halqa-600"
          >
            {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(s => (
              <option key={s} value={s}>{s}x</option>
            ))}
          </select>
          <div className="flex items-center gap-1">
            <Volume2 className="w-4 h-4 text-halqa-400" />
            <input type="range" min={0} max={1} step={0.05} value={volume}
              onChange={e => setVolume(parseFloat(e.target.value))}
              className="w-16 h-1 accent-halqa-400 cursor-pointer" />
          </div>
          <button onClick={handleDownload} className="p-2 rounded-full hover:bg-halqa-700 transition-colors" title="Download">
            <Download className="w-4 h-4 text-halqa-400" />
          </button>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-halqa-700 transition-colors">
            <X className="w-4 h-4 text-halqa-400" />
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Lesson Card ──────────────────────────────────────────────────────────────
function LessonCard({ lesson, onPlay, isPlaying, canEdit, onDelete, onEdit }: {
  lesson: Lesson; onPlay: () => void; isPlaying: boolean
  canEdit: boolean; onDelete: () => void; onEdit: () => void
}) {
  return (
    <div className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${isPlaying ? 'bg-halqa-50 border-halqa-300 ring-1 ring-halqa-300' : 'bg-white border-gray-100 hover:border-halqa-200 hover:shadow-sm'}`}>
      <button onClick={onPlay}
        className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 transition-all ${isPlaying ? 'bg-halqa-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-halqa-100 hover:text-halqa-700'}`}>
        {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
      </button>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold truncate ${isPlaying ? 'text-halqa-700' : 'text-gray-900'}`}>{lesson.title}</p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className="text-xs text-gray-500 flex items-center gap-1">
            <Clock className="w-3 h-3" />{formatDuration(lesson.duration)}
          </span>
          <span className="text-xs text-gray-400">{formatFileSize(lesson.fileSize)}</span>
          <Badge className={`text-xs border ${catColor(lesson.category?.slug)}`}>{lesson.category?.name}</Badge>
        </div>
        {lesson.description && <p className="text-xs text-gray-400 mt-0.5 truncate">{lesson.description}</p>}
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <span className="text-xs text-gray-400 hidden md:block">{lesson.playCount} plays</span>
        {canEdit && (
          <>
            <button onClick={onEdit} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
              <Edit className="w-3.5 h-3.5" />
            </button>
            <button onClick={onDelete} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function AudioPage() {
  const { user } = useAuthStore()
  const { isAdmin, isTeacher, isStudent, isGuardian, effectiveRole } = useEducationRole()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Player state
  const [nowPlaying, setNowPlaying] = useState<Lesson | null>(null)
  const [playlistLessons, setPlaylistLessons] = useState<Lesson[]>([])
  const [playIndex, setPlayIndex] = useState(0)

  // Filters
  const [search, setSearch] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterCourse, setFilterCourse] = useState('')
  const [activeTab, setActiveTab] = useState('browse')

  // Upload form
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadForm, setUploadForm] = useState({ title: '', description: '', courseId: '', categoryId: '' })
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  // Course form
  const [showCourseForm, setShowCourseForm] = useState(false)
  const [courseForm, setCourseForm] = useState({ title: '', description: '', categoryId: '' })

  // Category form
  const [showCatForm, setShowCatForm] = useState(false)
  const [catName, setCatName] = useState('')

  // Edit lesson
  const [editLesson, setEditLesson] = useState<Lesson | null>(null)
  const [editForm, setEditForm] = useState({ title: '', description: '' })
  const [deleteLessonId, setDeleteLessonId] = useState<string | null>(null)

  const canUpload = isTeacher

  // ─── Queries ────────────────────────────────────────────────────────────────
  const { data: categoriesData } = useQuery({
    queryKey: ['audio-categories'],
    queryFn: () => api.get('/audio/categories').then(r => r.data.data)
  })

  const { data: coursesData, isLoading: loadingCourses } = useQuery({
    queryKey: ['audio-courses', filterCategory],
    queryFn: () => api.get('/audio/courses', { params: { categoryId: filterCategory || undefined, limit: 100 } }).then(r => r.data.data)
  })

  const { data: lessonsData, isLoading: loadingLessons, isError: lessonsError, refetch: refetchLessons } = useQuery({
    queryKey: ['audio-lessons', filterCategory, filterCourse, search],
    queryFn: () => api.get('/audio/lessons', {
      params: {
        categoryId: filterCategory || undefined,
        courseId: filterCourse || undefined,
        search: search || undefined,
        limit: 100
      }
    }).then(r => r.data.data)
  })

  const categories: Category[] = categoriesData || []
  const courses: Course[] = coursesData || []
  const lessons: Lesson[] = lessonsData || []

  // ─── Mutations ──────────────────────────────────────────────────────────────
  const createCourseMutation = useMutation({
    mutationFn: (d: any) => api.post('/audio/courses', d),
    onSuccess: () => {
      toast({ title: 'Course created' })
      queryClient.invalidateQueries({ queryKey: ['audio-courses'] })
      setShowCourseForm(false)
      setCourseForm({ title: '', description: '', categoryId: '' })
    },
    onError: (e: any) => toast({ title: e.response?.data?.message || 'Failed', variant: 'destructive' })
  })

  const createCatMutation = useMutation({
    mutationFn: (name: string) => api.post('/audio/categories', { name }),
    onSuccess: () => {
      toast({ title: 'Category created' })
      queryClient.invalidateQueries({ queryKey: ['audio-categories'] })
      setShowCatForm(false)
      setCatName('')
    },
    onError: (e: any) => toast({ title: e.response?.data?.message || 'Failed', variant: 'destructive' })
  })

  const deleteLessonMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/audio/lessons/${id}`),
    onSuccess: () => {
      toast({ title: 'Lesson deleted' })
      queryClient.invalidateQueries({ queryKey: ['audio-lessons'] })
      if (nowPlaying) setNowPlaying(null)
    }
  })

  const updateLessonMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => api.put(`/audio/lessons/${id}`, data),
    onSuccess: () => {
      toast({ title: 'Lesson updated' })
      queryClient.invalidateQueries({ queryKey: ['audio-lessons'] })
      setEditLesson(null)
    }
  })

  // ─── Upload handler ──────────────────────────────────────────────────────────
  const handleUpload = async () => {
    if (!uploadFile || !uploadForm.title || !uploadForm.courseId) {
      toast({ title: 'Please fill in title, course, and select an audio file', variant: 'destructive' })
      return
    }
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('audio', uploadFile)
      fd.append('title', uploadForm.title)
      fd.append('description', uploadForm.description)
      fd.append('courseId', uploadForm.courseId)
      if (uploadForm.categoryId) fd.append('categoryId', uploadForm.categoryId)

      await api.post('/audio/lessons', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      toast({ title: 'Audio lesson uploaded successfully' })
      queryClient.invalidateQueries({ queryKey: ['audio-lessons'] })
      setUploadFile(null)
      setUploadForm({ title: '', description: '', courseId: '', categoryId: '' })
      setActiveTab('browse')
    } catch (e: any) {
      toast({ title: e.response?.data?.message || 'Upload failed', variant: 'destructive' })
    } finally {
      setUploading(false)
    }
  }

  // ─── Player helpers ──────────────────────────────────────────────────────────
  const playLesson = useCallback((lesson: Lesson, list?: Lesson[]) => {
    const pl = list || lessons
    const idx = pl.findIndex(l => l.id === lesson.id)
    setPlaylistLessons(pl)
    setPlayIndex(idx >= 0 ? idx : 0)
    setNowPlaying(lesson)
  }, [lessons])

  const playNext = useCallback(() => {
    if (playIndex < playlistLessons.length - 1) {
      const next = playlistLessons[playIndex + 1]
      setPlayIndex(playIndex + 1)
      setNowPlaying(next)
    }
  }, [playIndex, playlistLessons])

  const playPrev = useCallback(() => {
    if (playIndex > 0) {
      const prev = playlistLessons[playIndex - 1]
      setPlayIndex(playIndex - 1)
      setNowPlaying(prev)
    }
  }, [playIndex, playlistLessons])

  // ─── Group lessons by course ─────────────────────────────────────────────────
  const lessonsByCourse: Record<string, { course: Course | null; lessons: Lesson[] }> = {}
  lessons.forEach(l => {
    const key = l.course?.id || 'uncategorized'
    if (!lessonsByCourse[key]) {
      lessonsByCourse[key] = {
        course: courses.find(c => c.id === key) || null,
        lessons: []
      }
    }
    lessonsByCourse[key].lessons.push(l)
  })

  return (
    <div className={`space-y-6 ${nowPlaying ? 'pb-28' : ''}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Headphones className="w-6 h-6 text-halqa-700" /> Audio Lessons
          </h1>
          <p className="text-gray-500 text-sm">Islamic course audio — Tafsiira, Tawhiid, Tajwiid & more</p>
        </div>
        {canUpload && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowCourseForm(true)} className="gap-2">
              <BookOpen className="w-4 h-4" /> New Course
            </Button>
            <Button onClick={() => setActiveTab('upload')} className="bg-halqa-700 hover:bg-halqa-800 gap-2">
              <Upload className="w-4 h-4" /> Upload Audio
            </Button>
          </div>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-3 w-full md:w-auto">
          <TabsTrigger value="browse">Browse</TabsTrigger>
          {canUpload && <TabsTrigger value="upload">Upload</TabsTrigger>}
          {canUpload && <TabsTrigger value="manage">My Uploads</TabsTrigger>}
        </TabsList>

        {/* ── BROWSE TAB ── */}
        <TabsContent value="browse" className="space-y-4 mt-4">
          {/* Category pills */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => { setFilterCategory(''); setFilterCourse('') }}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all border ${!filterCategory ? 'bg-halqa-700 text-white border-halqa-700' : 'bg-white text-gray-600 border-gray-200 hover:border-halqa-300'}`}
            >
              All
            </button>
            {categories.map(cat => (
              <button
                key={cat.id}
                onClick={() => { setFilterCategory(cat.id); setFilterCourse('') }}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all border ${filterCategory === cat.id ? 'bg-halqa-700 text-white border-halqa-700' : `${catColor(cat.slug)} hover:opacity-80`}`}
              >
                {cat.name}
                {cat._count && <span className="ml-1 opacity-70">({cat._count.lessons})</span>}
              </button>
            ))}
            {canUpload && (
              <button
                onClick={() => setShowCatForm(true)}
                className="px-3 py-1.5 rounded-full text-sm font-medium border border-dashed border-gray-300 text-gray-500 hover:border-halqa-400 hover:text-halqa-600 transition-all flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> Custom
              </button>
            )}
          </div>

          {/* Search + course filter */}
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input placeholder="Search lessons..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
            </div>
            {courses.length > 0 && (
              <Select value={filterCourse || 'all'} onValueChange={v => setFilterCourse(v === 'all' ? '' : v)}>
                <SelectTrigger className="w-full md:w-56">
                  <SelectValue placeholder="All courses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Courses</SelectItem>
                  {courses.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Lessons grouped by course */}
          {loadingLessons ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
            </div>
          ) : lessonsError ? (
            <ErrorState onRetry={refetchLessons} />
          ) : lessons.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <Headphones className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="font-medium">No audio lessons found</p>
              {canUpload && <p className="text-sm mt-1">Upload your first lesson using the Upload tab</p>}
            </div>
          ) : (
            <div className="space-y-6">
              {Object.entries(lessonsByCourse).map(([courseId, { course, lessons: cLessons }]) => (
                <div key={courseId}>
                  <div className="flex items-center gap-2 mb-3">
                    <BookOpen className="w-4 h-4 text-halqa-600" />
                    <h3 className="font-semibold text-gray-900">{course?.title || 'Uncategorized'}</h3>
                    {course?.category && (
                      <Badge className={`text-xs border ${catColor(course.category.slug)}`}>{course.category.name}</Badge>
                    )}
                    <span className="text-xs text-gray-400 ml-auto">{cLessons.length} lesson{cLessons.length !== 1 ? 's' : ''}</span>
                    <button
                      onClick={() => playLesson(cLessons[0], cLessons)}
                      className="text-xs text-halqa-600 hover:text-halqa-700 font-medium flex items-center gap-1"
                    >
                      <Play className="w-3 h-3" /> Play all
                    </button>
                  </div>
                  <div className="space-y-2">
                    {cLessons.map(lesson => (
                      <LessonCard
                        key={lesson.id}
                        lesson={lesson}
                        onPlay={() => playLesson(lesson, cLessons)}
                        isPlaying={nowPlaying?.id === lesson.id}
                        canEdit={canUpload && (isAdmin || lesson.teacher?.user?.id === user?.id)}
                        onDelete={() => setDeleteLessonId(lesson.id)}
                        onEdit={() => { setEditLesson(lesson); setEditForm({ title: lesson.title, description: lesson.description || '' }) }}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── UPLOAD TAB ── */}
        {canUpload && (
          <TabsContent value="upload" className="space-y-4 mt-4 max-w-2xl">
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Upload className="w-4 h-4 text-halqa-700" /> Upload Audio Lesson
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Drop zone */}
                <div
                  onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={e => {
                    e.preventDefault(); setDragOver(false)
                    const f = e.dataTransfer.files[0]
                    if (f) setUploadFile(f)
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${dragOver ? 'border-halqa-500 bg-halqa-50' : 'border-gray-300 hover:border-halqa-400 hover:bg-gray-50'}`}
                >
                  <input ref={fileInputRef} type="file" accept=".mp3,.wav,.ogg,.m4a,.aac,audio/*" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) setUploadFile(f) }} />
                  {uploadFile ? (
                    <div className="flex items-center justify-center gap-3">
                      <div className="w-12 h-12 bg-halqa-100 rounded-xl flex items-center justify-center">
                        <Music className="w-6 h-6 text-halqa-700" />
                      </div>
                      <div className="text-left">
                        <p className="font-semibold text-gray-900 text-sm">{uploadFile.name}</p>
                        <p className="text-xs text-gray-500">{formatFileSize(uploadFile.size)}</p>
                      </div>
                      <button onClick={e => { e.stopPropagation(); setUploadFile(null) }}
                        className="ml-2 p-1 rounded-full hover:bg-red-50 text-gray-400 hover:text-red-500">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div>
                      <div className="w-14 h-14 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
                        <Headphones className="w-7 h-7 text-gray-400" />
                      </div>
                      <p className="text-sm font-semibold text-gray-700">Drop audio file here or click to browse</p>
                      <p className="text-xs text-gray-400 mt-1">MP3, WAV, OGG, M4A, AAC · Max 50 MB</p>
                    </div>
                  )}
                </div>

                {/* Form fields */}
                <div>
                  <Label>Lesson Title *</Label>
                  <Input className="mt-1" placeholder="e.g., Introduction to Tajwiid Rules"
                    value={uploadForm.title} onChange={e => setUploadForm(f => ({ ...f, title: e.target.value }))} />
                </div>
                <div>
                  <Label>Description</Label>
                  <Textarea className="mt-1" placeholder="Brief description of this lesson..."
                    value={uploadForm.description} onChange={e => setUploadForm(f => ({ ...f, description: e.target.value }))} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label>Course *</Label>
                    <Select value={uploadForm.courseId || 'none'} onValueChange={v => setUploadForm(f => ({ ...f, courseId: v === 'none' ? '' : v }))}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Select course" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Select a course</SelectItem>
                        {courses.map(c => <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {courses.length === 0 && (
                      <p className="text-xs text-orange-500 mt-1">No courses yet. Create one first.</p>
                    )}
                  </div>
                  <div>
                    <Label>Category (auto from course)</Label>
                    <Select value={uploadForm.categoryId || 'auto'} onValueChange={v => setUploadForm(f => ({ ...f, categoryId: v === 'auto' ? '' : v }))}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Auto from course" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Auto from course</SelectItem>
                        {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <Button
                  onClick={handleUpload}
                  disabled={uploading || !uploadFile || !uploadForm.title || !uploadForm.courseId}
                  className="bg-halqa-700 hover:bg-halqa-800 gap-2 w-full"
                >
                  {uploading ? <><Loader2 className="w-4 h-4 animate-spin" /> Uploading...</> : <><Upload className="w-4 h-4" /> Upload Lesson</>}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* ── MY UPLOADS TAB ── */}
        {canUpload && (
          <TabsContent value="manage" className="space-y-4 mt-4">
            {loadingLessons ? (
              <div className="space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
            ) : (
              <div className="space-y-2">
                {lessons
                  .filter(l => isAdmin || l.teacher?.user?.id === user?.id)
                  .map(lesson => (
                    <LessonCard
                      key={lesson.id}
                      lesson={lesson}
                      onPlay={() => playLesson(lesson)}
                      isPlaying={nowPlaying?.id === lesson.id}
                      canEdit={true}
                      onDelete={() => setDeleteLessonId(lesson.id)}
                      onEdit={() => { setEditLesson(lesson); setEditForm({ title: lesson.title, description: lesson.description || '' }) }}
                    />
                  ))}
                {lessons.filter(l => isAdmin || l.teacher?.user?.id === user?.id).length === 0 && (
                  <div className="text-center py-12 text-gray-500">
                    <Music className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                    <p>No uploads yet</p>
                  </div>
                )}
              </div>
            )}
          </TabsContent>
        )}
      </Tabs>

      {/* ── CREATE COURSE MODAL ── */}
      {showCourseForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md border-0 shadow-2xl">
            <CardHeader className="border-b pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Create New Course</CardTitle>
                <button onClick={() => setShowCourseForm(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
              </div>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
              <div>
                <Label>Course Title *</Label>
                <Input className="mt-1" placeholder="e.g., Tajwiid for Beginners"
                  value={courseForm.title} onChange={e => setCourseForm(f => ({ ...f, title: e.target.value }))} />
              </div>
              <div>
                <Label>Category *</Label>
                <Select value={courseForm.categoryId || 'none'} onValueChange={v => setCourseForm(f => ({ ...f, categoryId: v === 'none' ? '' : v }))}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select category" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Select category</SelectItem>
                    {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Description</Label>
                <Textarea className="mt-1" placeholder="What will students learn?"
                  value={courseForm.description} onChange={e => setCourseForm(f => ({ ...f, description: e.target.value }))} />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setShowCourseForm(false)} className="flex-1">Cancel</Button>
                <Button
                  onClick={() => createCourseMutation.mutate(courseForm)}
                  disabled={!courseForm.title || !courseForm.categoryId || createCourseMutation.isPending}
                  className="flex-1 bg-halqa-700 hover:bg-halqa-800 gap-2"
                >
                  {createCourseMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Create
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── CREATE CATEGORY MODAL ── */}
      {showCatForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-sm border-0 shadow-2xl">
            <CardHeader className="border-b pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">New Custom Category</CardTitle>
                <button onClick={() => setShowCatForm(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
              </div>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
              <div>
                <Label>Category Name *</Label>
                <Input className="mt-1" placeholder="e.g., Seerah, Fiqh, Aqeedah"
                  value={catName} onChange={e => setCatName(e.target.value)} />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setShowCatForm(false)} className="flex-1">Cancel</Button>
                <Button
                  onClick={() => createCatMutation.mutate(catName)}
                  disabled={!catName || createCatMutation.isPending}
                  className="flex-1 bg-halqa-700 hover:bg-halqa-800"
                >
                  {createCatMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── EDIT LESSON MODAL ── */}
      {editLesson && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md border-0 shadow-2xl">
            <CardHeader className="border-b pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Edit Lesson</CardTitle>
                <button onClick={() => setEditLesson(null)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
              </div>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
              <div>
                <Label>Title *</Label>
                <Input className="mt-1" value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} />
              </div>
              <div>
                <Label>Description</Label>
                <Textarea className="mt-1" value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setEditLesson(null)} className="flex-1">Cancel</Button>
                <Button
                  onClick={() => updateLessonMutation.mutate({ id: editLesson.id, data: editForm })}
                  disabled={!editForm.title || updateLessonMutation.isPending}
                  className="flex-1 bg-halqa-700 hover:bg-halqa-800"
                >
                  {updateLessonMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── AUDIO PLAYER ── */}
      {nowPlaying && (
        <AudioPlayer
          lesson={nowPlaying}
          onClose={() => setNowPlaying(null)}
          playlist={playlistLessons}
          onNext={playIndex < playlistLessons.length - 1 ? playNext : undefined}
          onPrev={playIndex > 0 ? playPrev : undefined}
        />
      )}

      <ConfirmDialog
        open={!!deleteLessonId}
        title="Delete Lesson"
        message="Are you sure you want to delete this audio lesson? This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        loading={deleteLessonMutation.isPending}
        onConfirm={() => { if (deleteLessonId) deleteLessonMutation.mutate(deleteLessonId); setDeleteLessonId(null) }}
        onCancel={() => setDeleteLessonId(null)}
      />
    </div>
  )
}


