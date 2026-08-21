'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { NoSSRChart } from '@/components/charts/no-ssr-chart'
import { useToast } from '@/components/ui/use-toast'
import { Plus, Star, TrendingUp, TrendingDown, Users, ThumbsUp, ThumbsDown } from 'lucide-react'
import { useAuthStore } from '@/store/auth.store'
import { useEducationRole } from '@/hooks/useEducationRole'
import { useDebounce } from '@/hooks/useDebounce'
import { ErrorState } from '@/components/ui/error-state'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell
} from 'recharts'
import { format } from 'date-fns'

const BEHAVIOR_CATEGORIES = [
  'Participation', 'Discipline', 'Homework Completion', 'Teamwork',
  'Quran Memorization', 'Respect', 'Punctuality', 'Cleanliness',
  'Leadership', 'Creativity', 'Focus', 'Prayer', 'Kindness',
  'Honesty', 'Responsibility', 'Effort', 'Cooperation', 'Listening',
  'Organization', 'Helpfulness', 'Courage', 'Patience', 'Gratitude',
  'Empathy', 'Self-Control', 'Initiative'
]

// ─── Student view component ───────────────────────────────────────────────────

function StudentBehaviorView() {
  const { user } = useAuthStore()
  const { isAdmin, isTeacher, isStudent, isGuardian, effectiveRole } = useEducationRole()

  const { data: myProfile } = useQuery({
    queryKey: ['my-profile-behavior'],
    queryFn: () => api.get('/auth/me').then(r => r.data.data),
  })
  const myStudentId = myProfile?.student?.id || user?.student?.id || ''

  const { data: behaviorData, isLoading } = useQuery({
    queryKey: ['my-behavior', myStudentId],
    queryFn: () => api.get(`/behavior/student/${myStudentId}`).then(r => r.data),
    enabled: !!myStudentId,
  })

  const logs: any[] = behaviorData?.data?.logs || []
  const stats = behaviorData?.data?.stats || {}
  const totalPoints = stats.totalPoints || 0
  const positive = stats.positive || 0
  const negative = stats.negative || 0

  // Category breakdown
  const categoryMap: Record<string, { positive: number; negative: number }> = {}
  logs.forEach((log: any) => {
    if (!categoryMap[log.category]) categoryMap[log.category] = { positive: 0, negative: 0 }
    if (log.type === 'POSITIVE') categoryMap[log.category].positive += log.points
    else categoryMap[log.category].negative += Math.abs(log.points)
  })
  const categoryData = Object.entries(categoryMap)
    .map(([cat, d]) => ({ category: cat, net: d.positive - d.negative }))
    .sort((a, b) => b.net - a.net)
    .slice(0, 8)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">My Behavior</h1>
        <p className="text-gray-500 text-sm">Your behavior points and history</p>
      </div>

      {/* Summary cards */}
      {isLoading ? (
        <div className="grid grid-cols-3 gap-3">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          <div className={`rounded-xl p-4 text-center ${totalPoints >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
            <p className={`text-3xl font-bold ${totalPoints >= 0 ? 'text-green-700' : 'text-red-700'}`}>
              {totalPoints >= 0 ? '+' : ''}{totalPoints}
            </p>
            <p className="text-xs font-medium mt-1 text-gray-500">Total Points</p>
          </div>
          <div className="bg-green-50 rounded-xl p-4 text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <ThumbsUp className="w-4 h-4 text-green-600" />
            </div>
            <p className="text-3xl font-bold text-green-700">{positive}</p>
            <p className="text-xs font-medium mt-0.5 text-gray-500">Positive</p>
          </div>
          <div className="bg-red-50 rounded-xl p-4 text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <ThumbsDown className="w-4 h-4 text-red-600" />
            </div>
            <p className="text-3xl font-bold text-red-700">{negative}</p>
            <p className="text-xs font-medium mt-0.5 text-gray-500">Negative</p>
          </div>
        </div>
      )}

      {/* Status badge */}
      {!isLoading && logs.length > 0 && (
        <div className={`flex items-center gap-3 p-4 rounded-xl ${
          totalPoints >= 50 ? 'bg-green-50 border border-green-200' :
          totalPoints >= 0  ? 'bg-blue-50 border border-blue-200' :
          'bg-orange-50 border border-orange-200'
        }`}>
          <div className="text-2xl">
            {totalPoints >= 50 ? '🌟' : totalPoints >= 0 ? '👍' : '⚠️'}
          </div>
          <div>
            <p className={`font-semibold text-sm ${
              totalPoints >= 50 ? 'text-green-800' :
              totalPoints >= 0  ? 'text-blue-800' : 'text-orange-800'
            }`}>
              {totalPoints >= 50 ? 'Excellent Behavior!' :
               totalPoints >= 0  ? 'Good Standing' : 'Needs Improvement'}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              {totalPoints >= 50 ? 'Keep up the great work!' :
               totalPoints >= 0  ? 'You\'re doing well, keep it up!' :
               'Talk to your teacher for guidance'}
            </p>
          </div>
        </div>
      )}

      {/* Category chart */}
      {!isLoading && categoryData.length > 1 && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Points by Category</CardTitle>
          </CardHeader>
          <CardContent>
            <NoSSRChart>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={categoryData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="category" tick={{ fontSize: 10 }} width={100} />
                  <Tooltip />
                  <Bar dataKey="net" radius={[0, 4, 4, 0]}>
                    {categoryData.map((entry, i) => (
                      <Cell key={i} fill={entry.net >= 0 ? '#10b981' : '#ef4444'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </NoSSRChart>
          </CardContent>
        </Card>
      )}

      {/* History */}
      {isLoading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
      ) : logs.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <Star className="w-10 h-10 text-gray-200 mx-auto mb-2" />
          <p className="text-sm font-medium text-gray-500">No behavior records yet</p>
        </div>
      ) : (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Behavior History ({logs.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-gray-100">
              {logs.map((log: any) => (
                <div key={log.id} className="flex items-center gap-3 px-4 py-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${
                    log.type === 'POSITIVE' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                  }`}>
                    {log.type === 'POSITIVE' ? '+' : ''}{log.points}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-gray-900">{log.category}</span>
                      <Badge
                        variant={log.type === 'POSITIVE' ? 'default' : 'destructive'}
                        className="text-xs"
                      >
                        {log.type === 'POSITIVE' ? '👍' : '👎'} {log.type}
                      </Badge>
                    </div>
                    {log.description && (
                      <p className="text-xs text-gray-500 mt-0.5">{log.description}</p>
                    )}
                    <p className="text-xs text-gray-400 mt-0.5">
                      {log.teacher?.user?.firstName} {log.teacher?.user?.lastName}
                      {' · '}{format(new Date(log.date), 'MMM d, yyyy')}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ─── Teacher/Admin view component ────────────────────────────────────────────

function TeacherBehaviorView() {
  const { user } = useAuthStore()
  const { isAdmin, isTeacher, isStudent, isGuardian, effectiveRole } = useEducationRole()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [selectedStudent, setSelectedStudent] = useState('')
  const [selectedClass, setSelectedClass] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [studentSearch, setStudentSearch] = useState('')
  const [form, setForm] = useState({ type: 'POSITIVE', category: '', points: '5', description: '' })
  const debouncedStudentSearch = useDebounce(studentSearch, 300)

  const { data: students } = useQuery({
    queryKey: ['students', debouncedStudentSearch],
    queryFn: () => api.get('/students', { params: { search: debouncedStudentSearch || undefined, limit: 20 } }).then(r => r.data.data)
  })

  const { data: classes } = useQuery({
    queryKey: ['classes'],
    queryFn: () => api.get('/classes').then(r => r.data.data)
  })

  const { data: behaviorData, isLoading: loadingStudent, isError: studentError, refetch: refetchStudent } = useQuery({
    queryKey: ['behavior', 'student', selectedStudent],
    queryFn: () => api.get(`/behavior/student/${selectedStudent}`).then(r => r.data),
    enabled: !!selectedStudent
  })

  const { data: classBehavior, isLoading: loadingClass } = useQuery({
    queryKey: ['behavior', 'class', selectedClass],
    queryFn: () => api.get('/behavior/summary', { params: { classId: selectedClass } }).then(r => r.data.data),
    enabled: !!selectedClass
  })

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post('/behavior', { ...data, studentId: selectedStudent }),
    onSuccess: () => {
      toast({ title: 'Behavior log added' })
      queryClient.invalidateQueries({ queryKey: ['behavior'] })
      setShowForm(false)
      setForm({ type: 'POSITIVE', category: '', points: '5', description: '' })
    },
    onError: () => toast({ title: 'Failed to add behavior log', variant: 'destructive' })
  })

  const canCreate = isTeacher
  const logs = behaviorData?.data?.logs || []
  const stats = behaviorData?.data?.stats || {}

  // Build class behavior chart data — use student names not IDs
  const classChartData = (() => {
    if (!classBehavior || !Array.isArray(classBehavior)) return []
    const studentMap: Record<string, { name: string; positive: number; negative: number; net: number }> = {}
    classBehavior.forEach((item: any) => {
      const sid = item.studentId
      if (!studentMap[sid]) {
        // Try to get name from students list
        const student = (students || []).find((s: any) => s.id === sid)
        const name = student
          ? `${student.user?.firstName || ''} ${student.user?.lastName || ''}`.trim()
          : sid.substring(0, 8)
        studentMap[sid] = { name, positive: 0, negative: 0, net: 0 }
      }
      const pts = item._sum?.points || 0
      if (item.type === 'POSITIVE') studentMap[sid].positive += pts
      else studentMap[sid].negative += Math.abs(pts)
      studentMap[sid].net = studentMap[sid].positive - studentMap[sid].negative
    })
    return Object.values(studentMap).sort((a, b) => b.net - a.net).slice(0, 15)
  })()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Behavior Tracking</h1>
        <p className="text-gray-500 text-sm">Monitor and record student behavior</p>
      </div>

      <Tabs defaultValue="student">
        <TabsList>
          <TabsTrigger value="student">Student View</TabsTrigger>
          <TabsTrigger value="class">Class Summary</TabsTrigger>
        </TabsList>

        {/* ── STUDENT VIEW ── */}
        <TabsContent value="student" className="space-y-4 mt-4">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="flex-1">
              <Label className="text-xs">Select Student</Label>
              <Select value={selectedStudent} onValueChange={setSelectedStudent}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Choose a student" />
                </SelectTrigger>
                <SelectContent>
                  {(students || []).map((s: any) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.user?.firstName} {s.user?.lastName} ({s.studentId})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {canCreate && selectedStudent && (
              <div className="flex items-end">
                <Button onClick={() => setShowForm(!showForm)} className="bg-halqa-700 hover:bg-halqa-800 gap-2">
                  <Plus className="w-4 h-4" /> Log Behavior
                </Button>
              </div>
            )}
          </div>

          {selectedStudent && (
            <>
              {/* Stats */}
              <div className="grid grid-cols-3 gap-3">
                <Card className="border-0 shadow-sm text-center">
                  <CardContent className="p-4">
                    <p className={`text-3xl font-bold ${(stats.totalPoints || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {(stats.totalPoints || 0) >= 0 ? '+' : ''}{stats.totalPoints || 0}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">Total Points</p>
                  </CardContent>
                </Card>
                <Card className="border-0 shadow-sm text-center">
                  <CardContent className="p-4">
                    <p className="text-3xl font-bold text-green-600">{stats.positive || 0}</p>
                    <p className="text-xs text-gray-500 mt-1">Positive</p>
                  </CardContent>
                </Card>
                <Card className="border-0 shadow-sm text-center">
                  <CardContent className="p-4">
                    <p className="text-3xl font-bold text-red-600">{stats.negative || 0}</p>
                    <p className="text-xs text-gray-500 mt-1">Negative</p>
                  </CardContent>
                </Card>
              </div>

              {/* Log form */}
              {showForm && (
                <Card className="border-0 shadow-sm border-l-4 border-l-yellow-400">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Log Behavior</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <Label>Type</Label>
                        <div className="flex gap-2 mt-1">
                          {['POSITIVE', 'NEGATIVE'].map(t => (
                            <button key={t} onClick={() => setForm(f => ({ ...f, type: t }))}
                              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                                form.type === t
                                  ? t === 'POSITIVE' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
                                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                              }`}>
                              {t === 'POSITIVE' ? '👍 Positive' : '👎 Negative'}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <Label>Category</Label>
                        <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                          <SelectTrigger className="mt-1"><SelectValue placeholder="Select category" /></SelectTrigger>
                          <SelectContent>
                            {BEHAVIOR_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Points (1–99)</Label>
                        <Input className="mt-1" type="number" min="1" max="99" value={form.points}
                          onChange={e => setForm(f => ({ ...f, points: e.target.value }))} />
                      </div>
                      <div>
                        <Label>Description (optional)</Label>
                        <Input className="mt-1" placeholder="Additional notes..." value={form.description}
                          onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
                      </div>
                    </div>
                    <div className="flex gap-2 mt-4">
                      <Button onClick={() => createMutation.mutate(form)}
                        disabled={!form.category || createMutation.isPending}
                        className="bg-halqa-700 hover:bg-halqa-800">
                        {createMutation.isPending ? 'Saving...' : 'Save'}
                      </Button>
                      <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* History */}
              <Card className="border-0 shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">Behavior History</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {loadingStudent ? (
                    <div className="p-6 text-center text-gray-400">Loading...</div>
                  ) : studentError ? (
                    <div className="p-4"><ErrorState onRetry={refetchStudent} /></div>
                  ) : logs.length === 0 ? (
                    <div className="p-8 text-center text-gray-400">
                      <Star className="w-8 h-8 mx-auto mb-2 text-gray-200" />
                      <p className="text-sm">No behavior logs yet</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-gray-100">
                      {logs.map((log: any) => (
                        <div key={log.id} className="flex items-center gap-3 px-4 py-3">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${
                            log.type === 'POSITIVE' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                          }`}>
                            {log.type === 'POSITIVE' ? '+' : ''}{log.points}
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-gray-900">{log.category}</span>
                              <Badge variant={log.type === 'POSITIVE' ? 'default' : 'destructive'} className="text-xs">
                                {log.type}
                              </Badge>
                            </div>
                            {log.description && <p className="text-xs text-gray-500 mt-0.5">{log.description}</p>}
                            <p className="text-xs text-gray-400 mt-0.5">
                              {log.teacher?.user?.firstName} {log.teacher?.user?.lastName} · {format(new Date(log.date), 'MMM d, yyyy')}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}

          {!selectedStudent && (
            <div className="text-center py-12 text-gray-400">
              <Star className="w-10 h-10 mx-auto mb-2 text-gray-200" />
              <p className="text-sm">Select a student to view behavior</p>
            </div>
          )}
        </TabsContent>

        {/* ── CLASS SUMMARY ── */}
        <TabsContent value="class" className="space-y-4 mt-4">
          <div>
            <Label className="text-xs">Select Class</Label>
            <Select value={selectedClass} onValueChange={setSelectedClass}>
              <SelectTrigger className="mt-1 max-w-xs">
                <SelectValue placeholder="Choose a class" />
              </SelectTrigger>
              <SelectContent>
                {(classes || []).map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedClass && (
            <>
              {loadingClass ? (
                <div className="h-64 bg-gray-100 rounded-xl animate-pulse" />
              ) : classChartData.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <Users className="w-10 h-10 mx-auto mb-2 text-gray-200" />
                  <p className="text-sm">No behavior data for this class</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <Card className="border-0 shadow-sm">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-semibold">Student Behavior Points</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <NoSSRChart>
                        <ResponsiveContainer width="100%" height={300}>
                          <BarChart data={classChartData} layout="vertical">
                            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                            <XAxis type="number" tick={{ fontSize: 11 }} />
                            <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={80} />
                            <Tooltip formatter={(v: any, name: string) => [v, name === 'net' ? 'Net Points' : name]} />
                            <Bar dataKey="net" name="Net Points" radius={[0, 4, 4, 0]}>
                              {classChartData.map((entry, i) => (
                                <Cell key={i} fill={entry.net >= 0 ? '#10b981' : '#ef4444'} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </NoSSRChart>
                    </CardContent>
                  </Card>

                  {/* Top performers */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Card className="border-0 shadow-sm">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-semibold text-green-700">🏆 Top Performers</CardTitle>
                      </CardHeader>
                      <CardContent className="p-0">
                        {classChartData.filter(s => s.net > 0).slice(0, 5).map((s, i) => (
                          <div key={s.name} className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-100 last:border-0">
                            <span className="text-sm font-bold text-gray-400 w-5">{i + 1}</span>
                            <span className="flex-1 text-sm text-gray-700 truncate">{s.name}</span>
                            <span className="text-sm font-bold text-green-600">+{s.net}</span>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                    <Card className="border-0 shadow-sm">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-semibold text-orange-600">⚠️ Needs Attention</CardTitle>
                      </CardHeader>
                      <CardContent className="p-0">
                        {classChartData.filter(s => s.net < 0).slice(-5).reverse().map((s, i) => (
                          <div key={s.name} className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-100 last:border-0">
                            <span className="text-sm font-bold text-gray-400 w-5">{i + 1}</span>
                            <span className="flex-1 text-sm text-gray-700 truncate">{s.name}</span>
                            <span className="text-sm font-bold text-red-600">{s.net}</span>
                          </div>
                        ))}
                        {classChartData.filter(s => s.net < 0).length === 0 && (
                          <p className="text-sm text-gray-400 text-center py-4">All students positive! 🎉</p>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                </div>
              )}
            </>
          )}

          {!selectedClass && (
            <div className="text-center py-12 text-gray-400">
              <Users className="w-10 h-10 mx-auto mb-2 text-gray-200" />
              <p className="text-sm">Select a class to view behavior summary</p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ─── Entry point — routes to role-specific view ───────────────────────────────
export default function BehaviorPage() {
  const { user } = useAuthStore()
  const { isAdmin, isTeacher, isStudent, isGuardian, effectiveRole } = useEducationRole()
  if (isStudent) return <StudentBehaviorView />
  return <TeacherBehaviorView />
}
