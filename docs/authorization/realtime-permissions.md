# Real-Time Permissions — Socket.IO

Authorization for Socket.IO events across all namespaces.

---

## Connection Authentication

File: `backend/src/app.js` — socket middleware

```javascript
io.use((socket, next) => {
  const token = socket.handshake.auth.token || socket.handshake.query.token;
  const decoded = verifyAccessToken(token);
  socket.userId     = decoded.userId;
  socket.userRole   = decoded.role;
  socket.userSchoolId = decoded.schoolId ?? null;
  next();
});
```

- JWT token required (from handshake auth or query)
- `socket.userId`, `socket.userRole`, `socket.userSchoolId` set from token — never from client payload
- Unauthenticated connections are rejected

---

## Automatic Room Joins (on connection)

Every authenticated socket automatically joins:

| Room | Who | Purpose |
|------|-----|---------|
| `user:{userId}` | All authenticated users | Personal events (DMs, kicks, mic offers, notifications) |
| `voice:lobby` | All authenticated users | Voice room created/deleted/updated broadcasts |
| `role:{userRole}` | All authenticated users | Role-specific broadcasts (e.g., `role:SUPER_ADMIN` for report alerts) |

---

## School Room — `school:join` / `school:leave`

SA-FIX-10: SUPER_ADMIN bypass removed.

```javascript
socket.on('school:join', (schoolId) => {
  if (socket.userSchoolId !== schoolId) return; // silently reject
  socket.join(`school:${schoolId}`);
});
```

| Role | Can join `school:{id}` | Rule |
|------|----------------------|------|
| Any user whose JWT schoolId matches | ✅ | Token-based check — never client payload |
| SUPER_ADMIN with matching schoolId | ✅ | Same rule applies |
| SUPER_ADMIN without matching schoolId | ❌ | SA-FIX-10: no global bypass |
| Any user with mismatched schoolId | ❌ | Silently rejected |

---

## School Feed Room — `feed:join:school`

⚠️ **SCOPE VIOLATION — LEGACY BYPASS STILL PRESENT**

```javascript
socket.on('feed:join:school', ({ schoolId } = {}) => {
  // SUPER_ADMIN global bypass (legacy)
  if (userRole === 'SUPER_ADMIN') {
    socket.join(`feed:school:${schoolId}`);
    return;
  }
  if (socket.userSchoolId !== schoolId) return;
  socket.join(`feed:school:${schoolId}`);
});
```

| Role | Access | Status |
|------|--------|--------|
| SUPER_ADMIN | Can join ANY school's feed room | ⚠️ VIOLATION — see known-gaps.md `SVSV-001` |
| User with matching schoolId | ✅ Allowed | Correct |
| User without matching schoolId | ❌ Blocked | Correct |

---

## Class Room — `class:join` / `class:leave`

SA-FIX-11: SUPER_ADMIN bypass removed. Membership check applies to all roles.

```javascript
socket.on('class:join', async (classId) => {
  const cls = await prisma.class.findFirst({ where: { id: classId } });
  const membership = await prisma.schoolMembership.findUnique({
    where: { userId_schoolId: { userId, schoolId: cls.schoolId } }
  });
  if ((!membership || membership.status !== 'ACTIVE') && socket.userSchoolId !== cls.schoolId) return;
  socket.join(`class:${classId}`);
});
```

| Role | Can join `class:{id}` | Rule |
|------|---------------------|------|
| Active school member (membership) | ✅ | DB check |
| User with matching schoolId (legacy) | ✅ | Fallback for pre-migration users |
| SUPER_ADMIN with school membership | ✅ | Same as any member |
| SUPER_ADMIN without membership | ❌ | SA-FIX-11: no global bypass |

---

## Live Class Room — `liveclass:join_room` / `liveclass:leave_room`

```javascript
socket.on('liveclass:join_room', async (liveClassId) => {
  const participant = await prisma.liveClassParticipant.findFirst({
    where: { liveClassId, userId, isActive: true }
  });
  if (!participant) return; // not an active participant — silently refuse
  socket.join(`liveclass:${liveClassId}`);
});
```

| Role | Can join `liveclass:{id}` | Rule |
|------|--------------------------|------|
| Active liveClassParticipant | ✅ | DB check — participant must be active |
| SUPER_ADMIN without participant record | ❌ | No bypass — must be an actual participant |
| Kicked user | ❌ | `isActive: false` after kick |

---

## Live Class Events (Server-Side Relay)

All client→server→room relay events re-verify authorization from DB. Client cannot spoof role.

| Event | Who can emit | Server verification |
|-------|-------------|---------------------|
| `liveclass:viewmode_changed` | HOST only | DB check: `liveClassParticipant.role === 'HOST'` |
| `liveclass:screen_share_started` | Participant; HOST or screenShareEnabled | DB check: active participant + role/feature flag |
| `liveclass:screen_share_stopped` | Active participant only | DB check: active participant |
| `liveclass:speaking` | Active participant only | Uses `socket.userId` (JWT) — never client-supplied userId |
| `liveclass:reaction` | Active participant only | Uses `socket.userId` |
| `liveclass:hand_raise` (relay) | Active participant only | Rate-limited via `socketAllow` |

---

## Voice Room Events

| Event | Who can emit | Access |
|-------|-------------|--------|
| `voice:join_room` | Any authenticated user (socket join verification in controller) | Active voiceParticipant required for token; socket room join handled separately |
| `voice:speaking` | Active voice participant | Socket presence in `voice:{roomId}` room |
| `voice:reaction` | Active voice participant | Socket presence |
| Role change events (broadcast) | Server → room | Emitted by controllers after DB update |
| `voice:kicked` | Server → `user:{userId}` | Emitted after DB kick |
| `voice:mic_offer` | Server → `user:{userId}` | After offer created in DB |

---

## DM / Typing Events

| Event | Who can emit | Access |
|-------|-------------|--------|
| `dm:typing_start` | Any authenticated user | Rate-limited; relayed to `user:{receiverId}` |
| `dm:typing_stop` | Any authenticated user | Rate-limited |

---

## SUPER_ADMIN Socket Summary

| Room | SUPER_ADMIN access | Notes |
|------|-------------------|-------|
| `user:{userId}` | ✅ Own user room | Same as everyone |
| `voice:lobby` | ✅ Global voice lobby | Same as everyone |
| `role:SUPER_ADMIN` | ✅ Admin broadcast room | Receives report alert notifications |
| `school:{id}` | ❌ No cross-school access | SA-FIX-10 |
| `feed:school:{id}` | ⚠️ **LEGACY BYPASS** (any school) | `SVSV-001` — see known-gaps.md |
| `class:{id}` | ❌ No bypass | SA-FIX-11 — needs school membership |
| `liveclass:{id}` | ❌ No bypass | Needs active liveClassParticipant |
| `voice:{roomId}` | ❌ No bypass | Needs active voiceParticipant |
