# Admin UI → Backend Trace

Full trace for every significant admin action: UI → Hook → API Client → HTTP → Middleware → Controller → DB → Audit → Realtime.

---

## Trace 1 — Load Overview Dashboard Stats

```
UI: /admin page renders
  └─ useQuery({ queryKey: ['admin-stats'], queryFn: () => api.get('/admin/stats') })
     └─ lib/api.ts (Axios instance, base URL = NEXT_PUBLIC_API_URL)
        └─ GET /api/v1/admin/stats
           └─ backend/src/app.js: app.use('/api/v1/admin/stats', adminStatsRoutes)
              └─ admin-stats.routes.js:
                 ├─ ipAllowlist middleware
                 ├─ authenticate middleware → Redis cache → DB users lookup → req.user
                 ├─ authorize('SUPER_ADMIN') → checks req.user.role
                 └─ router.get('/')
                    └─ Controller: Promise.all([
                         prisma.user.count(),
                         prisma.school.count(),
                         prisma.liveClass.count(),
                         prisma.auditLog.count(),
                         prisma.userReport.count({ where: { status: 'PENDING' } }),
                         ...
                       ])
                       → successResponse(res, { users, schools, liveClasses, moderation, audit, generatedAt })
  Response: { data: { users: {...}, schools: {...}, ... } }
  └─ React Query caches result, auto-refetch every 60s
  └─ UI renders StatCards with values
  
Audit: None (read operation)
Realtime: None
```

---

## Trace 2 — Change User Status (Suspend)

```
UI: /admin/users → user row → "Manage" button clicked
  └─ setSelected(user)  [local React state]
  └─ Dialog opens showing user info and status picker

User selects SUSPENDED, enters reason, clicks "Update Status"
  └─ mutation.mutate({ id: selected.id, status: 'SUSPENDED', reason: '...' })
     └─ useMutation({
          mutationFn: ({ id, status, reason }) => api.patch(`/admin/stats/users/${id}/status`, { status, reason })
        })
        └─ PATCH /api/v1/admin/stats/users/:id/status
           └─ admin-stats.routes.js:
              ├─ ipAllowlist
              ├─ authenticate → req.user (acting SUPER_ADMIN)
              ├─ authorize('SUPER_ADMIN')
              └─ handler:
                 ├─ Validates status ∈ ['ACTIVE','SUSPENDED','BANNED','INACTIVE']
                 ├─ Loads target user from DB
                 ├─ if (target.role === 'SUPER_ADMIN') → 403
                 └─ prisma.$transaction([
                      prisma.user.update({ where: { id }, data: { status } }),
                      prisma.auditLog.create({
                        userId:    req.user.id,       ← acting admin
                        action:    'UPDATE',
                        entity:    'user_status',
                        entityId:  targetId,
                        oldValues: { status: previousStatus },
                        newValues: { status: 'SUSPENDED', reason },
                        ipAddress: req.ip
                      })
                    ])
                 └─ invalidateUserCache(targetId)    ← Redis cache cleared
                 └─ successResponse(res, user)

React Query:
  └─ queryClient.invalidateQueries(['admin-users'])
  └─ queryClient.invalidateQueries(['admin-stats'])
  
Realtime: None (suspended user doesn't receive notification)
User effect: Next API call by target user receives 403 "Account suspended"
```

---

## Trace 3 — Deactivate a School

```
UI: /admin/schools → school row → "Deactivate" button → confirm dialog

User confirms in dialog:
  └─ mutation.mutate({ id: selected.id, isActive: false })
     └─ useMutation({
          mutationFn: ({ id, isActive }) => api.patch(`/admin/stats/schools/${id}/status`, { isActive })
        })
        └─ PATCH /api/v1/admin/stats/schools/:id/status
           └─ admin-stats.routes.js:
              ├─ ipAllowlist
              ├─ authenticate
              ├─ authorize('SUPER_ADMIN')
              └─ handler:
                 ├─ Validates typeof isActive === 'boolean'
                 ├─ prisma.school.update({ where: { id }, data: { isActive: false } })
                 └─ prisma.auditLog.create({
                      userId:    req.user.id,
                      action:    'UPDATE',
                      entity:    'school_status',
                      entityId:  schoolId,
                      oldValues: {},
                      newValues: { isActive: false }
                    })
                    
React Query: invalidateQueries(['admin-schools', 'admin-stats'])
Realtime: None
User effect: school.isActive = false (affects filtering; does NOT lock out users)
```

---

## Trace 4 — Review Report (ACTION_TAKEN + BAN)

```
UI: /admin/moderation → select report → choose ACTION_TAKEN → choose BAN → submit

  └─ reviewMutation.mutate({
       id:        report.id,
       status:    'ACTION_TAKEN',
       action:    'BAN',
       adminNote: '...'
     })
     └─ useMutation({
          mutationFn: ({ id, status, action, adminNote }) =>
            api.patch(`/report-block/reports/${id}/review`, { status, action, adminNote })
        })
        └─ PATCH /api/v1/report-block/reports/:id/review
           └─ [route path needs verification — see UIGAP-008]
           └─ Assumed: social.routes.js or report-block.routes.js:
              ├─ authenticate
              ├─ authorize('SUPER_ADMIN')
              └─ reviewReport controller:
                 ├─ Updates user_reports.status = 'ACTION_TAKEN'
                 ├─ Sets user_reports.reviewedBy = req.user.id
                 ├─ Sets user_reports.reviewedAt = now
                 ├─ If action === 'BAN':
                 │    prisma.user.update({ where: { id: reported.id }, data: { status: 'BANNED' } })
                 │    invalidateUserCache(reportedUserId)
                 └─ [Audit log: NOT WRITTEN for review action — UIGAP-013]
                 
React Query: invalidateQueries(['moderation-reports', 'admin-stats'])
Realtime: role:SUPER_ADMIN socket room (if new reports alert is fired)
User effect: Reported user → status = BANNED (immediate on next request)
```

---

## Trace 5 — Grant SUPER_ADMIN to User

```
UI: /admin/admins → "Grant Admin" → enter email → Find → enter reason → submit

Step 1 — User lookup:
  └─ api.get('/admin/stats/users', { params: { search: email, limit: 5 } })
     └─ Returns user array; UI finds exact email match
     └─ Sets lookupResult = matched user

Step 2 — Grant:
  └─ grantMutation.mutate({ targetUserId: lookupResult.id, reason })
     └─ useMutation({
          mutationFn: ({ targetUserId, reason }) =>
            api.post('/internal/admin/provision', { targetUserId, action: 'grant', reason })
        })
        └─ POST /api/v1/internal/admin/provision
           └─ internal.routes.js:
              ├─ ipAllowlist
              ├─ authenticate → req.user (acting SUPER_ADMIN)
              ├─ authorize('SUPER_ADMIN')
              └─ handler:
                 ├─ Validates action ∈ ['grant','revoke']
                 ├─ Blocks self-modification (targetUserId === req.user.id → 400)
                 ├─ Loads target user
                 ├─ For 'grant':
                 │    Checks target is not already SUPER_ADMIN
                 │    prisma.$transaction([
                 │      prisma.user.update({ data: { role: 'SUPER_ADMIN' } }),
                 │      prisma.auditLog.create({
                 │        action: 'UPDATE',
                 │        entity: 'user_platform_role',
                 │        newValues: { role: 'SUPER_ADMIN', action: 'GRANT_SUPER_ADMIN', reason, requestId }
                 │      })
                 │    ])
                 └─ invalidateUserCache(targetUserId)
                 
React Query: invalidateQueries(['admin-list'])
Realtime: None (new admin must re-login for role to take effect)
Effect: targetUser.role = 'SUPER_ADMIN' in DB; cache cleared immediately
```

---

## Trace 6 — Emergency End Live Class (Current Behavior — 403)

```
UI: /admin/live-voice → live class row → "End" button → confirm()

  └─ endLiveMutation.mutate(session.id)
     └─ useMutation({
          mutationFn: (id) => api.post(`/live-classes/${id}/end`)
        })
        └─ POST /api/v1/live-classes/:id/end
           └─ live-class.routes.js:
              ├─ authenticate → req.user (SUPER_ADMIN)
              └─ resolveStreamStaffAccess:
                 ├─ Loads live class: stream_type, host_user_id
                 ├─ If PUBLIC stream → checks req.user.id === hostUserId → FAIL (403 unless SA is the host)
                 └─ If SCHOOL stream → runs eduStaff:
                    ├─ requireSchoolMember() → loads SchoolMembership for SUPER_ADMIN
                    ├─ SUPER_ADMIN has no school membership → 403 "You are not a member of this school"
                    └─ STOPS HERE

Result: HTTP 403
UI: toast({ title: 'Failed', description: '403 error message' })

Expected behavior: A dedicated admin termination endpoint should bypass content auth:
POST /api/v1/admin/live-classes/:id/terminate
→ ipAllowlist + authorize('SUPER_ADMIN') → no school/host check → endLiveClass logic + admin audit log
```

---

## Trace 7 — Load System Health

```
UI: /admin/system-health → useQuery(['system-health'])
  └─ api.get('/health/detailed')
     └─ GET /api/v1/health/detailed
        └─ health.routes.js (route file TBD)
           └─ [Authorization: UNKNOWN — see UIGAP-014]
           └─ Controller: checks database ping, Redis ping, LiveKit ping, memory, event loop
              └─ Returns: { status, checks: { database, redis, livekit, memory, eventLoop, circuitBreakers }, uptime, ... }
              
React Query: auto-refetch every 30s
```

---

## Layers That DO NOT Exist (Missing Backend Components)

| Admin UI Action | Missing Backend Layer |
|----------------|----------------------|
| End live class (admin) | No `POST /admin/live-classes/:id/terminate` route |
| End voice room (admin) | No `POST /admin/voice/:id/terminate` route |
| View payout requests | No `GET /admin/payouts` route |
| Approve payout | No `PATCH /admin/payouts/:id/status` route |
| Grant coins | No `POST /admin/users/:id/credits` route |
| Revoke user sessions | No `DELETE /admin/users/:id/sessions` route |
| Create platform announcement | No `POST /admin/announcements` route |
| Manage gift catalog | No `POST/PATCH/DELETE /admin/gifts/:id` route |
| Manage coin packages | No `POST/PATCH/DELETE /admin/coin-packages/:id` route |
