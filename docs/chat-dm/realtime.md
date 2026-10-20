# Chat/DM — Realtime Events

**Audit date:** 2026-08-26

---

## Direct Messages

| Event | Direction | Target | Payload |
|-------|-----------|--------|---------|
| `dm:message` | S→user | `user:{receiverId}` | `{ convId, message }` |
| `dm:delivered` | S→user | `user:{senderId}` | `{ convId, messageIds }` |
| `dm:read` | S→user | `user:{otherId}` | `{ convId, readBy, readAt }` |
| `dm:typing_start` | C→S relay | `user:{receiverId}` | `{ convId, userId }` (rate: 20/5s) |
| `dm:typing_stop` | C→S relay | `user:{receiverId}` | `{ convId, userId }` (rate: 20/5s) |

## Group Chat

| Event | Direction | Target | Payload |
|-------|-----------|--------|---------|
| `group:join` | C→S | server | DB-verified membership join |
| `group:leave` | C→S | server | Leave socket room |
| `group:typing_start` | C→S relay | `conversation:{convId}` | `{ convId, userId, name }` |
| `group:typing_stop` | C→S relay | `conversation:{convId}` | `{ convId, userId }` |
| Group message created | S→room | `conversation:{convId}` | new message |

All relay events use `socket.userId` — never client-supplied userId.

## Security Notes

- `group:join`: DB membership check required before socket room access
- `dm:typing_start/stop`: rate-limited 20/5s per socket
- DM events target `user:{userId}` personal rooms — never broadcast to a shared room
