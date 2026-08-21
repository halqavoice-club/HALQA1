'use client'

/**
 * School Member Management page
 *
 * Allows SCHOOL_ADMIN and SUPER_ADMIN to:
 *  - View all members of the active school
 *  - Filter by role / status
 *  - Approve pending join requests
 *  - Suspend / re-activate members
 *  - Invite new members by email
 *  - Remove members
 *
 * Only shown to users with admin role in their active school.
 * Backend validates membership on every API call — this UI is not the authority.
 */

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import { useSchoolAccess } from '@/hooks/useSchoolAccess'
import {
  Users, UserCheck, GraduationCap, UserPlus, Shield,
  CheckCircle2, XCircle, Clock, Trash2, Mail,
  AlertCircle, RefreshCw, Loader2, Search, ChevronDown
} from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { getAvatarUrl } from '@/lib/avatar'

type Member = {
  id: string
  userId: string
  schoolId: string
  role: string
  status: string
  joinedAt: string
  user: {
    id: string
    firstName: string
    lastName: string
    email: string
    avatarUrl: string | null
    lastLoginAt: string | null
  }
}

const ROLE_COLORS: Record<string, string> = {
  SUPER_ADMIN:  'bg-red-100 text-red-700',
  SCHOOL_ADMIN: 'bg-purple-100 text-purple-700',
  TEACHER:      'bg-green-100 text-green-700',
  STUDENT:      'bg-blue-100 text-blue-700',
  GUARDIAN:     'bg-orange-100 text-orange-700',
}

const STATUS_ICONS: Record<string, React.ElementType> = {
  ACTIVE:    CheckCircle2,
  PENDING:   Clock,
  SUSPENDED: XCircle,
}

const STATUS_COLORS: Record<string, string> = {
  ACTIVE:    'text-green-600',
  PENDING:   'text-yellow-600',
  SUSPENDED: 'text-red-600',
}

export default function ManageMembersPage() {
  const router = useRouter()
  const { activeSchool, activeRole, activeSchoolId, hasSchools } = useSchoolAccess()

  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [filterRole,   setFilterRole]   = useState<string>('all')
  const [search, setSearch]             = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  // Invite form state
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole,  setInviteRole]  = useState('STUDENT')
  const [inviting, setInviting]       = useState(false)
  const [inviteMsg, setInviteMsg]     = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  // Role change state
  const [roleChangeId,   setRoleChangeId]   = useState<string | null>(null)
  const [roleChangeVal,  setRoleChangeVal]  = useState('')
  const [roleChanging,   setRoleChanging]   = useState(false)

  // Only admins can access this page
  const isAdmin = activeRole === 'SUPER_ADMIN' || activeRole === 'SCHOOL_ADMIN'

  const fetchMembers = useCallback(async () => {
    if (!activeSchoolId || !isAdmin) return
    setLoading(true)
    setError(null)
    try {
      const statusParam = filterStatus !== 'all' ? `&status=${filterStatus}` : ''
      const roleParam   = filterRole   !== 'all' ? `&role=${filterRole}`     : ''
      const res = await api.get(`/school-memberships/school/${activeSchoolId}?limit=100${statusParam}${roleParam}`)
      setMembers(res.data.data || [])
    } catch (e: any) {
      setError(e.response?.data?.message || 'Failed to load members')
    } finally {
      setLoading(false)
    }
  }, [activeSchoolId, isAdmin, filterStatus, filterRole])

  useEffect(() => { fetchMembers() }, [fetchMembers])

  // Redirect non-admins
  useEffect(() => {
    if (!loading && hasSchools && !isAdmin) router.replace('/dashboard')
  }, [loading, hasSchools, isAdmin, router])

  async function updateStatus(memberId: string, status: string) {
    setActionLoading(memberId)
    try {
      await api.put(`/school-memberships/${memberId}/status`, { status })
      await fetchMembers()
    } catch (e: any) {
      setError(e.response?.data?.message || 'Failed to update status')
    } finally {
      setActionLoading(null)
    }
  }

  async function removeMember(memberId: string) {
    if (!confirm('Remove this member from the school?')) return
    setActionLoading(memberId)
    try {
      await api.delete(`/school-memberships/${memberId}`)
      await fetchMembers()
    } catch (e: any) {
      setError(e.response?.data?.message || 'Failed to remove member')
    } finally {
      setActionLoading(null)
    }
  }

  async function handleRoleChange(memberId: string, newRole: string) {
    setRoleChanging(true)
    try {
      await api.put(`/school-memberships/${memberId}/role`, { role: newRole })
      setRoleChangeId(null)
      await fetchMembers()
    } catch (e: any) {
      setError(e.response?.data?.message || 'Failed to change role')
    } finally {
      setRoleChanging(false)
    }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setInviting(true)
    setInviteMsg(null)
    try {
      await api.post('/school-memberships/invite', {
        schoolId: activeSchoolId,
        userEmail: inviteEmail,
        role: inviteRole,
      })
      setInviteMsg({ type: 'ok', text: `${inviteEmail} invited as ${inviteRole}` })
      setInviteEmail('')
      await fetchMembers()
    } catch (e: any) {
      setInviteMsg({ type: 'err', text: e.response?.data?.message || 'Invite failed' })
    } finally {
      setInviting(false)
    }
  }

  const filtered = members.filter(m => {
    const name = `${m.user.firstName} ${m.user.lastName} ${m.user.email}`.toLowerCase()
    return name.includes(search.toLowerCase())
  })

  const pendingCount = members.filter(m => m.status === 'PENDING').length

  if (!hasSchools) {
    return (
      <div className="max-w-lg mx-auto mt-20 text-center px-4">
        <Users className="w-12 h-12 text-gray-300 mx-auto mb-4" />
        <p className="text-gray-500">You are not a member of any school.</p>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto py-8 px-4 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">School Members</h1>
          <p className="text-sm text-gray-500 mt-0.5">{activeSchool?.name}</p>
        </div>
        <button
          onClick={fetchMembers}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Pending requests banner */}
      {pendingCount > 0 && (
        <div className="flex items-center gap-3 p-4 bg-yellow-50 border border-yellow-200 rounded-xl text-yellow-800 text-sm">
          <Clock className="w-5 h-5 flex-shrink-0" />
          <span>
            <strong>{pendingCount}</strong> pending join request{pendingCount > 1 ? 's' : ''} awaiting approval.
          </span>
          <button
            onClick={() => setFilterStatus('PENDING')}
            className="ml-auto text-yellow-700 hover:underline text-xs font-medium"
          >
            Show pending
          </button>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Member list — 2/3 width */}
        <div className="lg:col-span-2 space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search members…"
                className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="all">All Statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="PENDING">Pending</option>
              <option value="SUSPENDED">Suspended</option>
            </select>
            <select
              value={filterRole}
              onChange={e => setFilterRole(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="all">All Roles</option>
              <option value="SUPER_ADMIN">Super Admin</option>
              <option value="SCHOOL_ADMIN">Admin</option>
              <option value="TEACHER">Teacher</option>
              <option value="STUDENT">Student</option>
              <option value="GUARDIAN">Guardian</option>
            </select>
          </div>

          {/* Member rows */}
          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-400">
              <Loader2 className="w-6 h-6 animate-spin mr-2" />Loading members…
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <Users className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm">No members found</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map(m => {
                const StatusIcon = STATUS_ICONS[m.status] || Clock
                const isActing   = actionLoading === m.id
                return (
                  <div key={m.id} className="flex items-center gap-3 p-3 bg-white border border-gray-200 rounded-xl hover:border-gray-300 transition-colors">
                    <Avatar className="w-9 h-9 flex-shrink-0">
                      <AvatarImage src={getAvatarUrl(m.user.avatarUrl)} />
                      <AvatarFallback className="bg-gray-100 text-gray-600 text-xs">
                        {m.user.firstName[0]}{m.user.lastName[0]}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {m.user.firstName} {m.user.lastName}
                      </p>
                      <p className="text-xs text-gray-500 truncate">{m.user.email}</p>
                    </div>

                    {/* Role — click to open role-change dropdown */}
                    <div className="relative flex-shrink-0">
                      {roleChangeId === m.id ? (
                        <div className="flex items-center gap-1">
                          <select
                            value={roleChangeVal}
                            onChange={e => setRoleChangeVal(e.target.value)}
                            className="text-xs border border-indigo-400 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            autoFocus
                          >
                            <option value="TEACHER">Teacher</option>
                            <option value="STUDENT">Student</option>
                            <option value="GUARDIAN">Guardian</option>
                            {activeRole === 'SUPER_ADMIN' && <option value="SCHOOL_ADMIN">School Admin</option>}
                          </select>
                          <button
                            onClick={() => handleRoleChange(m.id, roleChangeVal)}
                            disabled={roleChanging || roleChangeVal === m.role}
                            className="text-xs bg-indigo-600 text-white px-2 py-1 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                          >
                            {roleChanging ? '…' : 'Save'}
                          </button>
                          <button
                            onClick={() => setRoleChangeId(null)}
                            className="text-xs text-gray-400 hover:text-gray-600 px-1"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setRoleChangeId(m.id); setRoleChangeVal(m.role) }}
                          title="Change role"
                          className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full transition-colors hover:opacity-80 ${ROLE_COLORS[m.role] || 'bg-gray-100 text-gray-600'}`}
                        >
                          {m.role.replace(/_/g, ' ')}
                          <ChevronDown className="w-2.5 h-2.5" />
                        </button>
                      )}
                    </div>

                    <StatusIcon className={`w-4 h-4 flex-shrink-0 ${STATUS_COLORS[m.status] || 'text-gray-400'}`} />

                    {/* Actions */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {isActing ? (
                        <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                      ) : (
                        <>
                          {m.status === 'PENDING' && (
                            <button
                              onClick={() => updateStatus(m.id, 'ACTIVE')}
                              title="Approve"
                              className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                            >
                              <CheckCircle2 className="w-4 h-4" />
                            </button>
                          )}
                          {m.status === 'ACTIVE' && (
                            <button
                              onClick={() => updateStatus(m.id, 'SUSPENDED')}
                              title="Suspend"
                              className="p-1.5 text-yellow-600 hover:bg-yellow-50 rounded-lg transition-colors"
                            >
                              <XCircle className="w-4 h-4" />
                            </button>
                          )}
                          {m.status === 'SUSPENDED' && (
                            <button
                              onClick={() => updateStatus(m.id, 'ACTIVE')}
                              title="Reactivate"
                              className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                            >
                              <CheckCircle2 className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            onClick={() => removeMember(m.id)}
                            title="Remove from school"
                            className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Invite panel — 1/3 width */}
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-indigo-500" />
              Invite a Member
            </h3>
            <form onSubmit={handleInvite} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Email address</label>
                <div className="relative">
                  <Mail className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={e => setInviteEmail(e.target.value)}
                    required
                    placeholder="user@example.com"
                    className="w-full pl-8 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Role</label>
                <select
                  value={inviteRole}
                  onChange={e => setInviteRole(e.target.value)}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {activeRole === 'SUPER_ADMIN' && <option value="SCHOOL_ADMIN">School Admin</option>}
                  <option value="TEACHER">Teacher</option>
                  <option value="STUDENT">Student</option>
                  <option value="GUARDIAN">Guardian</option>
                </select>
              </div>
              {inviteMsg && (
                <p className={`text-xs ${inviteMsg.type === 'ok' ? 'text-green-600' : 'text-red-600'}`}>
                  {inviteMsg.text}
                </p>
              )}
              <button
                type="submit"
                disabled={inviting || !inviteEmail}
                className="w-full py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
              >
                {inviting ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                {inviting ? 'Sending…' : 'Send Invite'}
              </button>
            </form>
          </div>

          {/* Stats */}
          <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-2">
              <Shield className="w-4 h-4 text-gray-400" />
              Summary
            </h3>
            {[
              { role: 'TEACHER',      icon: UserCheck,      label: 'Teachers' },
              { role: 'STUDENT',      icon: GraduationCap,  label: 'Students' },
              { role: 'GUARDIAN',     icon: Users,          label: 'Guardians' },
              { role: 'SCHOOL_ADMIN', icon: Shield,         label: 'Admins' },
            ].map(({ role, icon: Icon, label }) => {
              const count = members.filter(m => m.role === role && m.status === 'ACTIVE').length
              return (
                <div key={role} className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <Icon className="w-3.5 h-3.5 text-gray-400" />
                    {label}
                  </div>
                  <span className="text-sm font-semibold text-gray-900">{count}</span>
                </div>
              )
            })}
            <div className="pt-2 border-t border-gray-100 flex items-center justify-between">
              <span className="text-sm text-gray-500">Total active</span>
              <span className="text-sm font-bold text-gray-900">
                {members.filter(m => m.status === 'ACTIVE').length}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
