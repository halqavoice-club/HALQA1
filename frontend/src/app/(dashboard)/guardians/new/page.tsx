'use client'

/**
 * Add New Guardian — Friends Only
 *
 * A School Admin can ONLY add a guardian by selecting from their social friends.
 * No manual creation (name/email/phone) is allowed.
 *
 * After selecting a friend, fill in:
 *   - Relationship (required)
 *   - Link Students (optional)
 */

import { useState, useEffect, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { useToast } from '@/components/ui/use-toast'
import { ArrowLeft, Loader2, UserPlus, Search, X, UserCheck, Users } from 'lucide-react'
import Link from 'next/link'
import { getAvatarUrl } from '@/lib/avatar'

const RELATIONSHIPS = ['parent', 'guardian', 'grandparent', 'uncle', 'aunt', 'sibling', 'other']

const schema = z.object({
  relationship: z.string().default('parent'),
})
type Form = z.infer<typeof schema>

type Friend = {
  id: string
  firstName: string
  lastName: string
  email: string
  avatarUrl?: string | null
}

export default function NewGuardianPage() {
  const router      = useRouter()
  const { toast }   = useToast()
  const queryClient = useQueryClient()

  const [userQuery,   setUserQuery]   = useState('')
  const [userResults, setUserResults] = useState<Friend[]>([])
  const [searching,   setSearching]   = useState(false)
  const [linkedUser,  setLinkedUser]  = useState<Friend | null>(null)
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [selectedStudents, setSelectedStudents] = useState<any[]>([])
  const [studentSearch,    setStudentSearch]    = useState('')

  const { register, handleSubmit, setValue } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { relationship: 'parent' },
  })

  // Friends search
  useEffect(() => {
    if (searchRef.current) clearTimeout(searchRef.current)
    if (!userQuery.trim() || userQuery.length < 2) { setUserResults([]); return }
    setSearching(true)
    searchRef.current = setTimeout(async () => {
      try {
        const res = await api.get('/social/friends', { params: { search: userQuery.trim(), limit: 8 } })
        setUserResults(res.data.data || [])
      } catch { setUserResults([]) }
      finally { setSearching(false) }
    }, 300)
  }, [userQuery])

  function handleSelectFriend(u: Friend) {
    setLinkedUser(u)
    setUserQuery('')
    setUserResults([])
  }

  const { data: studentsData } = useQuery({
    queryKey: ['students-search', studentSearch],
    queryFn:  () => api.get('/students', { params: { search: studentSearch, limit: 10 } }).then(r => r.data.data),
    enabled:  studentSearch.length >= 2,
  })

  const addStudent = (student: any) => {
    if (!selectedStudents.find(s => s.id === student.id)) {
      setSelectedStudents(prev => [...prev, student])
    }
    setStudentSearch('')
  }

  const mutation = useMutation({
    mutationFn: (data: Form) => api.post('/guardians', {
      ...data,
      linkedUserId: linkedUser!.id,
      firstName:    linkedUser!.firstName,
      lastName:     linkedUser!.lastName,
      email:        linkedUser!.email || undefined,
      studentIds:   selectedStudents.map(s => s.id),
    }),
    onSuccess: () => {
      toast({ title: 'Guardian added successfully' })
      queryClient.invalidateQueries({ queryKey: ['guardians'] })
      router.push('/guardians')
    },
    onError: (err: any) => {
      toast({ title: err?.response?.data?.message || 'Failed to add guardian', variant: 'destructive' })
    },
  })

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/guardians" className="text-gray-500 hover:text-gray-700">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Add New Guardian</h1>
          <p className="text-gray-500 text-sm">Select from your social friends</p>
        </div>
      </div>

      {/* Step 1 — Select friend */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Users className="w-4 h-4 text-halqa-600" />
            Select Friend *
          </CardTitle>
          <p className="text-xs text-gray-500 mt-0.5">
            Only your social friends can be added as guardians. They must already have a HALQA account.
          </p>
        </CardHeader>
        <CardContent>
          {linkedUser ? (
            <div className="flex items-center gap-3 p-3 bg-halqa-50 border border-halqa-200 rounded-xl">
              <Avatar className="w-9 h-9 flex-shrink-0">
                <AvatarImage src={getAvatarUrl(linkedUser.avatarUrl)} />
                <AvatarFallback className="bg-halqa-100 text-halqa-700 text-xs font-bold">
                  {linkedUser.firstName[0]}{linkedUser.lastName[0]}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-halqa-900 truncate">{linkedUser.firstName} {linkedUser.lastName}</p>
                <p className="text-xs text-halqa-600 truncate">{linkedUser.email}</p>
              </div>
              <div className="flex items-center gap-1 text-xs text-green-600 font-medium flex-shrink-0">
                <UserCheck className="w-3.5 h-3.5" /> Selected
              </div>
              <button type="button" onClick={() => setLinkedUser(null)} className="text-gray-400 hover:text-gray-600 flex-shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="relative">
              <div className="flex items-center gap-2 border border-gray-300 rounded-lg px-3 focus-within:ring-2 focus-within:ring-halqa-500">
                <Search className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <input
                  type="text"
                  value={userQuery}
                  onChange={e => setUserQuery(e.target.value)}
                  placeholder="Search your friends by name…"
                  className="flex-1 py-2 text-sm outline-none bg-transparent"
                  autoComplete="off"
                  autoFocus
                />
                {searching && <Loader2 className="w-4 h-4 animate-spin text-gray-400 flex-shrink-0" />}
                {userQuery && !searching && (
                  <button type="button" onClick={() => { setUserQuery(''); setUserResults([]) }}>
                    <X className="w-4 h-4 text-gray-400 hover:text-gray-600" />
                  </button>
                )}
              </div>
              {userResults.length > 0 && (
                <div className="absolute z-20 top-full mt-1 left-0 right-0 bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
                  {userResults.map(u => (
                    <button key={u.id} type="button" onClick={() => handleSelectFriend(u)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-halqa-50 text-left transition-colors">
                      <Avatar className="w-8 h-8 flex-shrink-0">
                        <AvatarImage src={getAvatarUrl(u.avatarUrl)} />
                        <AvatarFallback className="bg-gray-100 text-gray-600 text-xs">{u.firstName[0]}{u.lastName[0]}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{u.firstName} {u.lastName}</p>
                        <p className="text-xs text-gray-500 truncate">{u.email}</p>
                      </div>
                      <span className="text-xs text-green-600 font-medium flex-shrink-0 flex items-center gap-1">
                        <UserCheck className="w-3 h-3" /> Friend
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {userQuery.length >= 2 && !searching && userResults.length === 0 && (
                <p className="mt-2 text-xs text-gray-400">
                  No friends found for &quot;{userQuery}&quot;. Only social friends can be added as guardians.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Step 2 — Guardian details (only after friend selected) */}
      {linkedUser && (
        <form onSubmit={handleSubmit(d => mutation.mutate(d))} className="space-y-4">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Guardian Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Relationship to Student *</Label>
                <Select defaultValue="parent" onValueChange={v => setValue('relationship', v)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {RELATIONSHIPS.map(r => (
                      <SelectItem key={r} value={r} className="capitalize">
                        {r.charAt(0).toUpperCase() + r.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Link students */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Link Students (Optional)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="relative">
                <Input
                  placeholder="Search students by name or ID…"
                  value={studentSearch}
                  onChange={e => setStudentSearch(e.target.value)}
                />
                {studentsData && studentsData.length > 0 && studentSearch.length >= 2 && (
                  <div className="absolute top-full mt-1 left-0 right-0 bg-white rounded-lg shadow-lg border z-10 max-h-48 overflow-y-auto">
                    {studentsData.map((s: any) => (
                      <button key={s.id} type="button" onClick={() => addStudent(s)}
                        className="w-full text-left px-3 py-2.5 hover:bg-gray-50 text-sm flex items-center gap-2">
                        <div className="w-7 h-7 bg-halqa-100 rounded-full flex items-center justify-center text-xs font-bold text-halqa-700 flex-shrink-0">
                          {s.user?.firstName?.[0]}{s.user?.lastName?.[0]}
                        </div>
                        <div>
                          <p className="font-medium">{s.user?.firstName} {s.user?.lastName}</p>
                          <p className="text-xs text-gray-400">{s.studentId}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {selectedStudents.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {selectedStudents.map((s, i) => (
                    <Badge key={s.id} variant="secondary" className="gap-1 pl-2 pr-1 py-1">
                      {i === 0 && <span className="text-xs text-halqa-600 mr-1">Primary</span>}
                      {s.user?.firstName} {s.user?.lastName}
                      <button type="button" onClick={() => setSelectedStudents(p => p.filter(x => x.id !== s.id))} className="ml-1 hover:text-red-500">
                        <X className="w-3 h-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              <p className="text-xs text-gray-400">The first student linked will be marked as primary.</p>
            </CardContent>
          </Card>

          <div className="bg-green-50 rounded-lg p-4 text-sm text-green-700 flex items-start gap-2">
            <UserCheck className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <p>
              <strong>{linkedUser.firstName}</strong> already has a HALQA account.
              They will be linked to your school as a Guardian — no new account or password is created.
            </p>
          </div>

          <div className="flex gap-3">
            <Button type="submit" className="bg-halqa-700 hover:bg-halqa-800 gap-2" disabled={mutation.isPending}>
              {mutation.isPending
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Adding...</>
                : <><UserPlus className="w-4 h-4" /> Add as Guardian</>
              }
            </Button>
            <Link href="/guardians"><Button type="button" variant="outline">Cancel</Button></Link>
          </div>
        </form>
      )}
    </div>
  )
}
